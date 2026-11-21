# Dot-sourced by the ELEVATED scripts that read a folder the app wrote unelevated (setup-daemon.ps1,
# apply-daemon-config.ps1). rc9-c D1-D3 (macOS testing's root-step audit, the macOS app 4a419a1c0 ported to Windows):
#  D1  the staging path was any caller-given path, and Remove-Item -Recurse (PowerShell 5.1) follows a junction
#      inside it: SYSTEM deleted whatever it pointed at. Assert-StagingPath + Remove-StagingTree (.NET
#      Directory.Delete does not recurse into a reparse point).
#  D2  links in staging were followed: a staged config.toml linked to a SYSTEM-only file was copied into the
#      user-readable service config. Every staged file is opened with FILE_FLAG_OPEN_REPARSE_POINT and refused
#      when it is a link, a hard link (more than one name) or resolves anywhere but its own path.
#  D3  check-then-copy: the checks and the copy read the user's folder seconds apart. Each file is read ONCE into
#      an admin-only snapshot folder; every check and copy after that reads the snapshot.
# Errors start with a code (STAGING-PATH / STAGING-LINK / STAGING-SIZE) and say nothing was installed.
# ASCII only (PowerShell 5.1 reads cp1252).

$StagingReparse = [System.IO.FileAttributes]::ReparsePoint

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class DvpnStagedRead {
  [StructLayout(LayoutKind.Sequential)]
  struct BY_HANDLE_FILE_INFORMATION {
    public uint Attributes; public uint Ct1, Ct2, At1, At2, Wt1, Wt2; public uint Volume;
    public uint SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle h, out BY_HANDLE_FILE_INFORMATION info);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint GetFinalPathNameByHandleW(SafeFileHandle h, StringBuilder buf, uint size, uint flags);

  const uint GENERIC_READ = 0x80000000;
  const uint FILE_SHARE_READ = 1;
  const uint OPEN_EXISTING = 3;
  const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
  const uint ATTR_DIRECTORY = 0x10;
  const uint ATTR_REPARSE = 0x400;

  // One staged file, read through a handle that never follows a link; refused unless it is a plain file with one
  // name whose final path is the path asked for (a junction in a parent folder resolves somewhere else).
  public static byte[] Read(string path, long max) {
    string want = Path.GetFullPath(path);
    using (SafeFileHandle h = CreateFileW(want, GENERIC_READ, FILE_SHARE_READ, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero)) {
      if (h.IsInvalid) throw new IOException("STAGING-LINK: cannot open " + want + " (error " + Marshal.GetLastWin32Error() + "); nothing was installed");
      BY_HANDLE_FILE_INFORMATION info;
      if (!GetFileInformationByHandle(h, out info)) throw new IOException("STAGING-LINK: cannot read " + want + "; nothing was installed");
      if ((info.Attributes & ATTR_REPARSE) != 0) throw new IOException("STAGING-LINK: " + want + " is a link; nothing was installed");
      if ((info.Attributes & ATTR_DIRECTORY) != 0) throw new IOException("STAGING-LINK: " + want + " is a folder; nothing was installed");
      if (info.Links != 1) throw new IOException("STAGING-LINK: " + want + " has " + info.Links + " names (a hard link); nothing was installed");
      StringBuilder sb = new StringBuilder(1024);
      uint n = GetFinalPathNameByHandleW(h, sb, (uint)sb.Capacity, 0);
      if (n == 0 || n >= sb.Capacity) throw new IOException("STAGING-LINK: cannot resolve " + want + "; nothing was installed");
      string final = sb.ToString();
      if (final.StartsWith(@"\\?\UNC\")) final = @"\\" + final.Substring(8);
      else if (final.StartsWith(@"\\?\")) final = final.Substring(4);
      if (!string.Equals(final, want, StringComparison.OrdinalIgnoreCase)) throw new IOException("STAGING-LINK: " + want + " resolves to " + final + "; nothing was installed");
      long size = ((long)info.SizeHigh << 32) | info.SizeLow;
      if (size > max) throw new IOException("STAGING-SIZE: " + want + " is " + size + " bytes (limit " + max + "); nothing was installed");
      byte[] buf = new byte[size];
      using (FileStream fs = new FileStream(h, FileAccess.Read)) {
        int off = 0;
        while (off < size) { int r = fs.Read(buf, off, (int)(size - off)); if (r <= 0) break; off += r; }
        if (off != size) throw new IOException("STAGING-SIZE: " + want + " changed while it was read; nothing was installed");
      }
      return buf;
    }
  }
}
'@

# The folder the app staged into: an absolute plain path whose last part is one of $Leaves, with no link or
# junction anywhere on it. Returns the full path.
function Assert-StagingPath([string]$Path, [string[]]$Leaves) {
  if (-not $Path -or -not [System.IO.Path]::IsPathRooted($Path) -or $Path.StartsWith('\\')) { throw "STAGING-PATH: not a local absolute path: $Path; nothing was installed" }
  $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
  if ($full -ne $Path.TrimEnd('\')) { throw "STAGING-PATH: not a plain path: $Path; nothing was installed" }
  if ($Leaves -notcontains [System.IO.Path]::GetFileName($full)) { throw "STAGING-PATH: the staging folder must be named $($Leaves -join ' or '): $full; nothing was installed" }
  $cur = $full
  while ($cur) {
    if (Test-Path -LiteralPath $cur) {
      if (((Get-Item -LiteralPath $cur -Force).Attributes -band $StagingReparse) -ne 0) { throw "STAGING-LINK: $cur is a link or junction; nothing was installed" }
    }
    $parent = Split-Path -Parent $cur
    if ([string]::IsNullOrEmpty($parent)) { break }
    $cur = $parent
  }
  return $full
}

# A new folder only SYSTEM and Administrators can open, created WITH that ACL (no window in which a user who may
# create files in Windows\Temp can add one).
function New-StagingSnapshotDir {
  $dir = Join-Path $env:SystemRoot ('Temp\dvpn-stage-' + [guid]::NewGuid().ToString('N'))
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($s in 'S-1-5-18', 'S-1-5-32-544') {
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
      (New-Object System.Security.Principal.SecurityIdentifier($s)),
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      ([System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'),
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow)))
  }
  [void][System.IO.Directory]::CreateDirectory($dir, $acl)
  return $dir
}

# One staged file into the snapshot, read once with every link refused.
function Copy-StagedFile([string]$From, [string]$To, [long]$Max = 1048576) {
  # rc9-d (Windows testing w11): a .NET exception reaches PowerShell wrapped ('Exception calling "Read" with "2" argument(s):
  # "STAGING-LINK: ..."'), so the result detail no longer started with its code. Re-thrown as the bare message.
  try { $bytes = [DvpnStagedRead]::Read($From, $Max) }
  catch { throw $_.Exception.GetBaseException().Message }
  [System.IO.File]::WriteAllBytes($To, $bytes)
}

# The whole staged tree into a new snapshot folder (at most $MaxFiles files of $Max bytes). A link or junction
# anywhere: the snapshot is removed and the step fails. Returns the snapshot path.
function Copy-StagingSnapshot([string]$From, [int]$MaxFiles = 256, [long]$Max = 1048576) {
  $snap = New-StagingSnapshotDir
  try {
    $count = 0
    $todo = New-Object System.Collections.Stack
    $todo.Push(@($From, $snap))
    while ($todo.Count -gt 0) {
      $pair = $todo.Pop()
      foreach ($e in (New-Object System.IO.DirectoryInfo($pair[0])).GetFileSystemInfos()) {
        if (($e.Attributes -band $StagingReparse) -ne 0) { throw "STAGING-LINK: $($e.FullName) is a link or junction; nothing was installed" }
        $dst = Join-Path $pair[1] $e.Name
        if ($e -is [System.IO.DirectoryInfo]) {
          [void][System.IO.Directory]::CreateDirectory($dst)
          $todo.Push(@($e.FullName, $dst))
        } else {
          $count++
          if ($count -gt $MaxFiles) { throw "STAGING-SIZE: more than $MaxFiles files in $From; nothing was installed" }
          Copy-StagedFile $e.FullName $dst $Max
        }
      }
    }
    return $snap
  } catch {
    Remove-StagingTree $snap
    throw
  }
}

# Remove a staging or snapshot folder without entering any link: every link or junction is removed on its own
# first (a non-recursive delete of a link removes the link, never its target), then the tree that is left.
# rc9-d (Windows testing w11): .NET Framework's Directory.Delete(path, $true) failed "The parameter is incorrect" on a tree
# holding a junction, so the staging copy stayed behind. PowerShell 5.1 Remove-Item -Recurse is never used.
# Read-only files are made writable first; a failure is a warning, never a stop.
function Remove-StagingTree([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return }
  try {
    $top = Get-Item -LiteralPath $Path -Force
    if (($top.Attributes -band $StagingReparse) -ne 0) {
      [System.IO.Directory]::Delete($top.FullName)
      return
    }
    $todo = New-Object System.Collections.Stack
    $todo.Push($top.FullName)
    while ($todo.Count -gt 0) {
      foreach ($e in (New-Object System.IO.DirectoryInfo($todo.Pop())).GetFileSystemInfos()) {
        if (($e.Attributes -band $StagingReparse) -ne 0) {
          if ($e -is [System.IO.DirectoryInfo]) { [System.IO.Directory]::Delete($e.FullName) } else { [System.IO.File]::Delete($e.FullName) }
        }
        elseif ($e -is [System.IO.DirectoryInfo]) { $todo.Push($e.FullName) }
        elseif (($e.Attributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0) { $e.Attributes = $e.Attributes -bxor [System.IO.FileAttributes]::ReadOnly }
      }
    }
    [System.IO.Directory]::Delete($Path, $true)
  } catch {
    Write-Warning "could not remove $($Path): $($_.Exception.Message)"
  }
}
