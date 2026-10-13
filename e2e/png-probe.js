// PNG 像素探针：在一个空白页里把图解码进 canvas，数接近某个颜色的像素。
// 给 ppnt shot 的出图断言用——出图里有没有某条 CSS 画出来的颜色，比只看 PNG 头可靠。
export async function countColorPixels(context, png, [r, g, b], tolerance = 16) {
  const page = await context.newPage();
  try {
    return await page.evaluate(async ({ src, r, g, b, tolerance }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i] - r) <= tolerance && Math.abs(data[i + 1] - g) <= tolerance && Math.abs(data[i + 2] - b) <= tolerance) n += 1;
      }
      return n;
    }, { src: `data:image/png;base64,${png.toString('base64')}`, r, g, b, tolerance });
  } finally {
    await page.close();
  }
}
