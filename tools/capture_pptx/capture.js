const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const pptxgen = require("pptxgenjs");
const puppeteer = require("puppeteer");

const baseDir = path.resolve(__dirname, "..", "..");
const htmlPath = path.join(baseDir, "index.html");
const outPptx = path.join(baseDir, "홈페이지new1_캡처.pptx");
const capDir = path.join(__dirname, "caps");

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const VIEW_W = 1920;
const VIEW_H = 1080; // 16:9

(async () => {
  if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
  for (const f of fs.readdirSync(capDir)) fs.unlinkSync(path.join(capDir, f));

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env.CHROME_PATH || undefined,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1 });

  const fileUrl = pathToFileURL(htmlPath).toString();
  await page.goto(fileUrl, { waitUntil: "load", timeout: 60000 });

  // Wait for images to load
  await page.evaluate(async () => {
    const imgs = Array.from(document.images || []);
    await Promise.all(
      imgs.map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((res) => {
                img.onload = img.onerror = res;
              })
      )
    );
  });

  // Freeze the hero headline to the first message
  await page.addStyleTag({
    content: `
      * { animation: none !important; transition: none !important; }
      .hero__headline .headline--one { opacity: 1 !important; }
      .hero__headline .headline--two { opacity: 0 !important; }
    `,
  });

  // Ensure full height is multiple of viewport height so each slide is 16:9
  const fullHeight = await page.evaluate(() => document.body.scrollHeight);
  const totalHeight = Math.ceil(fullHeight / VIEW_H) * VIEW_H;
  await page.evaluate((h) => {
    document.body.style.minHeight = h + "px";
  }, totalHeight);

  const segments = Math.ceil(totalHeight / VIEW_H);
  const capPaths = [];

  for (let i = 0; i < segments; i++) {
    const y = i * VIEW_H;
    const capPath = path.join(capDir, `cap_${String(i + 1).padStart(2, "0")}.png`);
    await page.screenshot({
      path: capPath,
      clip: { x: 0, y, width: VIEW_W, height: VIEW_H },
    });
    capPaths.push(capPath);
  }

  await browser.close();

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";

  capPaths.forEach((p) => {
    const slide = pptx.addSlide();
    slide.addImage({ path: p, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
  });

  await pptx.writeFile({ fileName: outPptx });
  console.log("PPTX created:", outPptx);
})();
