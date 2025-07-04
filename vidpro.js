import { randomBytes, createDecipheriv, createCipheriv } from "crypto";
import fetch from "node-fetch";
import { argv } from "process";

const API_URL = "https://vidlink.pro/api/b";
const keyHex = "2de6e6ea13a9df9503b11a6117fd7e51941e04a0c223dfeacfe8a1dbb6c52783";
const algo = "aes-256-cbc";

function extractVideoId(link) {
  // Example implementation, adjust according to actual URL structure
  const match = link.match(/vidlink\.pro\/(.+)/);
  return match ? match[1] : null;
}


async function getVideo(id) {
  const encodedId = Buffer.from(encrypt(id)).toString('base64');
  const url = `${API_URL}/movie/${encodedId}`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error("Error fetching video details:", response.statusText);
    return;
  }

  const decryptedData = decryptClearKey(await response.text());
  return JSON.parse(decryptedData);
}

function encrypt(data) {
  const iv = randomBytes(16);
  const key = Buffer.from(keyHex, "hex").slice(0, 32);
  const cipher = createCipheriv(algo, key, iv);
  let encrypted = cipher.update(data);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptClearKey(data) {
  const [ivHex, encryptedHex] = data.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const key = Buffer.from(keyHex, "hex").slice(0, 32);
  const decipher = createDecipheriv(algo, key, iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

async function main() {
  const link = argv[2];
  if (!link) {
    console.error("Please provide a vidlink.pro link.");
    return;
  }

  const videoId = extractVideoId(link); // Implement this function based on your link structure
  const videoData = await getVideo(videoId);
  console.log(videoData);
}

main();