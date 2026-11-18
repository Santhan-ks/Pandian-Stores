import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  openSync,
  readSync,
  closeSync,
  statSync,
  renameSync,
} from "node:fs";
import { pipeline, finished } from "node:stream/promises";
import { Writable, type Readable } from "node:stream";

const magic = Buffer.from("PANDIAN1");
function backupKey(hex: string) {
  if (!/^[a-f0-9]{64}$/.test(hex))
    throw new Error("Backup key must be a private, random 32-byte hex value.");
  return Buffer.from(hex, "hex");
}
export async function encryptBackup(
  source: Readable,
  destination: string,
  key: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", backupKey(key), iv);
  cipher.setAAD(magic);
  const output = createWriteStream(destination + ".partial", {
    flags: "wx",
    mode: 0o600,
    flush: true,
  });
  output.write(Buffer.concat([magic, iv]));
  await pipeline(source, cipher, output, { end: false });
  output.end(cipher.getAuthTag());
  await finished(output);
  // flush:true syncs the complete stream before closing the file.
  renameSync(destination + ".partial", destination);
}

function decrypt(file: string, key: string) {
  const size = statSync(file).size;
  if (size < 36 || file.endsWith(".partial"))
    throw new Error("Incomplete encrypted backup.");
  const header = Buffer.alloc(20),
    tag = Buffer.alloc(16);
  const fd = openSync(file, "r");
  try {
    readSync(fd, header, 0, 20, 0);
    readSync(fd, tag, 0, 16, size - 16);
  } finally {
    closeSync(fd);
  }
  if (!header.subarray(0, 8).equals(magic))
    throw new Error("Unsupported backup format.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    backupKey(key),
    header.subarray(8),
  );
  decipher.setAAD(magic);
  decipher.setAuthTag(tag);
  return {
    source: createReadStream(file, { start: 20, end: size - 17 }),
    decipher,
  };
}

export async function verifyBackup(file: string, key: string) {
  const { source, decipher } = decrypt(file, key);
  // Authenticate the entire dump before any restore process is started.
  await pipeline(
    source,
    decipher,
    new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  );
}

export async function decryptBackup(
  file: string,
  key: string,
  output: Writable,
) {
  const { source, decipher } = decrypt(file, key);
  await pipeline(source, decipher, output);
}
