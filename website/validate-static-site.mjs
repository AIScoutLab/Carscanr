import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pages = [
  { path: "index.html", required: ["CarScanr", "Identify any vehicle from a single photo.", "Coming soon on the App Store."] },
  { path: "support/index.html", required: ["CarScanr Support", "support@carscanr.com", "1-2 business days"] },
  { path: "privacy/index.html", required: ["CarScanr Privacy Policy", "support@carscanr.com"] },
  { path: "terms/index.html", required: ["CarScanr Terms of Service", "support@carscanr.com"] },
];

const requiredAssets = ["styles.css", "assets/logo.png"];
const missing = [];

for (const asset of requiredAssets) {
  if (!fs.existsSync(path.join(root, asset))) {
    missing.push(asset);
  }
}

for (const page of pages) {
  const fullPath = path.join(root, page.path);
  if (!fs.existsSync(fullPath)) {
    missing.push(page.path);
    continue;
  }
  const html = fs.readFileSync(fullPath, "utf8");
  for (const text of page.required) {
    if (!html.includes(text)) {
      throw new Error(`${page.path} is missing required text: ${text}`);
    }
  }
  for (const href of ["/support/", "/privacy/", "/terms/"]) {
    if (!html.includes(`href="${href}"`)) {
      throw new Error(`${page.path} is missing navigation link: ${href}`);
    }
  }
}

if (missing.length > 0) {
  throw new Error(`Missing site files: ${missing.join(", ")}`);
}

console.log("Static site validation passed for /, /support, /privacy, and /terms.");
