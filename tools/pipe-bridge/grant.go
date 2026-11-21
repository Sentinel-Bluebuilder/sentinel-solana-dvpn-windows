package main

// ─── -grant: no sign-out after the first service install ───
// dvpnd lets SYSTEM, Administrators and the sentinel-dvpn group open its pipe. Windows adds a new
// group to a user's token only at the next sign-in, so right after the first install the app was
// locked out until the user signed out and back in (owner's laptop 2026-11-12). The elevated install
// step runs this to add the user's own SID, with the same narrow rights as the group, to the live
// pipe's DACL. The DACL belongs to the pipe, so it covers every instance until the service restarts;
// by the next boot the user has signed in again and holds the group. Elevated scripts re-run it after
// every service restart they cause.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func grantPipe(pipe, sidText string) error {
	sid, err := windows.StringToSid(sidText)
	if err != nil {
		return fmt.Errorf("bad SID: %w", err)
	}
	if !strings.HasPrefix(sidText, "S-1-5-21-") {
		return errors.New("only a local or domain user SID may be granted")
	}
	h, err := openForDACL(pipe, 15*time.Second)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)

	sd, err := windows.GetSecurityInfo(h, windows.SE_KERNEL_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return fmt.Errorf("reading pipe security: %w", err)
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return fmt.Errorf("reading pipe DACL: %w", err)
	}
	if hasACE(dacl, sid) {
		fmt.Printf("granted %s (already)\n", sidText)
		return nil
	}
	entry := windows.EXPLICIT_ACCESS{
		AccessPermissions: daemonClientRights,
		AccessMode:        windows.GRANT_ACCESS,
		Inheritance:       windows.NO_INHERITANCE,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_USER,
			TrusteeValue: windows.TrusteeValueFromSID(sid),
		},
	}
	next, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{entry}, dacl)
	if err != nil {
		return fmt.Errorf("building DACL: %w", err)
	}
	if err := windows.SetSecurityInfo(h, windows.SE_KERNEL_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, next, nil); err != nil {
		return fmt.Errorf("writing pipe DACL: %w", err)
	}
	after, err := windows.GetSecurityInfo(h, windows.SE_KERNEL_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return fmt.Errorf("re-reading pipe security: %w", err)
	}
	d2, _, err := after.DACL()
	if err != nil || !hasACE(d2, sid) {
		return errors.New("the pipe did not keep the new entry")
	}
	fmt.Printf("granted %s %s\n", sidText, after.String())
	return nil
}

// openForDACL opens the pipe as a client with only READ_CONTROL|WRITE_DAC (no data access), waiting
// while every instance is busy.
func openForDACL(pipe string, wait time.Duration) (windows.Handle, error) {
	name, err := windows.UTF16PtrFromString(pipe)
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	for {
		h, err := windows.CreateFile(name, windows.READ_CONTROL|windows.WRITE_DAC, 0, nil, windows.OPEN_EXISTING, 0, 0)
		if err == nil {
			return h, nil
		}
		if !errors.Is(err, windows.ERROR_PIPE_BUSY) && !errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
			return 0, fmt.Errorf("opening %s: %w", pipe, err)
		}
		select {
		case <-ctx.Done():
			return 0, fmt.Errorf("opening %s: %w (waited %s)", pipe, err, wait)
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func hasACE(acl *windows.ACL, sid *windows.SID) bool {
	if acl == nil {
		return false
	}
	for i := uint32(0); i < uint32(acl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(acl, i, &ace); err != nil {
			continue
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			continue
		}
		aceSid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if aceSid.Equals(sid) {
			return true
		}
	}
	return false
}
