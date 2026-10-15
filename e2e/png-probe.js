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

// 两张同尺寸 PNG 里差得超过 tolerance 的像素占比（0~1）；尺寸不同直接算 1。
// 给“悬停前后这块区域画出来的东西不变”这类断言用。
export async function diffPixelRatio(context, a, b, tolerance = 16) {
  const page = await context.newPage();
  try {
    return await page.evaluate(async ({ srcA, srcB, tolerance }) => {
      const load = async (src) => { const img = new Image(); img.src = src; await img.decode(); return img; };
      const [ia, ib] = await Promise.all([load(srcA), load(srcB)]);
      if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) return 1;
      const read = (img) => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const da = read(ia);
      const db = read(ib);
      let n = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i] - db[i]) > tolerance || Math.abs(da[i + 1] - db[i + 1]) > tolerance || Math.abs(da[i + 2] - db[i + 2]) > tolerance) n += 1;
      }
      return n / (da.length / 4);
    }, { srcA: `data:image/png;base64,${a.toString('base64')}`, srcB: `data:image/png;base64,${b.toString('base64')}`, tolerance });
  } finally {
    await page.close();
  }
}
