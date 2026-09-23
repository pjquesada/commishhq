import sharp from "sharp";
for (const size of [192, 512])
  await sharp("public/icons/icon.svg")
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}.png`);
await sharp("public/icons/icon.svg")
  .resize(180, 180)
  .png()
  .toFile("public/icons/apple-touch-icon.png");
await sharp("public/icons/icon.svg")
  .resize(360, 360)
  .extend({ top: 76, bottom: 76, left: 76, right: 76, background: "#153e35" })
  .png()
  .toFile("public/icons/maskable-512.png");
