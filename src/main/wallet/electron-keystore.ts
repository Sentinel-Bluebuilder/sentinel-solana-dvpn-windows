// ─── safeStorage KeyStore (desktop app) ───
// Ported from sentinel-node-manager-solana services/wallet.ts: refuse to store
// the key when the OS cannot encrypt it.
import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Keypair } from '@solana/web3.js';
import { keypairFromInput, keypairToJson } from '../../core/wallet/keys';
import type { KeyStore } from '../host';
import { log } from '../logger';
import { ShownError } from '../../shared/i18n';

export function safeStorageKeyStore(dataDir: string): KeyStore {
  const file = path.join(dataDir, 'wallet.secret');
  // Q0567 (Agent M, Mac): the public address beside the secret, so start-up and the blocked view never decrypt
  // (on macOS each update makes the Keychain ask for the login password on the first decrypt). Not a secret.
  const addrFile = path.join(dataDir, 'wallet.address');
  const writeAddr = (kp: Keypair): void => {
    try { fs.writeFileSync(addrFile, kp.publicKey.toBase58()); }
    catch (err) { log.warn('wallet: could not store the public address', { err: (err as Error).message }); }
  };
  const requireEncryption = (): void => {
    if (!safeStorage.isEncryptionAvailable()) throw new ShownError('This computer cannot safely store your wallet key. Sign in to your Windows account and try again.');
  };
  return {
    kind: 'safeStorage',
    exists: () => fs.existsSync(file),
    load(): Keypair | null {
      if (!fs.existsSync(file)) return null;
      requireEncryption();
      try {
        const kp = keypairFromInput(safeStorage.decryptString(fs.readFileSync(file)));
        if (!fs.existsSync(addrFile)) writeAddr(kp); // a wallet saved by an older version
        return kp;
      } catch (err) {
        log.error('wallet: stored key could not be decrypted', err);
        throw new ShownError('Your stored wallet could not be unlocked on this Windows account.');
      }
    },
    save(kp) {
      requireEncryption();
      // Whole file or nothing (L-25): a crash or full disk mid-write left a cut wallet.secret that
      // could never be unlocked again. Written beside it, then renamed over it.
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, safeStorage.encryptString(keypairToJson(kp)));
      fs.renameSync(tmp, file);
      writeAddr(kp);
    },
    address(): string | null {
      if (!fs.existsSync(file) || !fs.existsSync(addrFile)) return null;
      const a = fs.readFileSync(addrFile, 'utf8').trim();
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
    },
    remove() {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      if (fs.existsSync(addrFile)) fs.unlinkSync(addrFile);
    },
  };
}
