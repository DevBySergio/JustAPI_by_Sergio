import sharp from 'sharp';
import { mkdirSync } from 'fs';

const size = 128;

const svg = `<svg width="${size}" height="${size}" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#16213e"/>
    </linearGradient>
  </defs>

  <!-- Background rounded rect -->
  <rect width="128" height="128" rx="24" fill="url(#bg)"/>

  <!-- Lightning bolt -->
  <path d="M52 8 L28 68 L50 68 L38 120 L86 54 L60 54 L74 8 Z"
        fill="#FFD700" stroke="#FFA000" stroke-width="1.5" stroke-linejoin="round"/>

  <!-- "API" text -->
  <text x="64" y="112" font-family="Arial, Helvetica, sans-serif"
        font-size="28" font-weight="bold" fill="#ffffff"
        text-anchor="middle" letter-spacing="4">API</text>
</svg>`;

mkdirSync('media', { recursive: true });

await sharp(Buffer.from(svg))
  .resize(size, size)
  .png()
  .toFile('media/icon.png');

console.log('Icon generated: media/icon.png');
