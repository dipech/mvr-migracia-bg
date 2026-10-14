import sharp from 'sharp';
for(const size of [180,192,512])await sharp('public/icon.svg').resize(size,size).png().toFile(`public/${size===180?'apple-touch-icon':`icon-${size}`}.png`);
