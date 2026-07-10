import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pages = [
  {
    path: "index.html",
    required: [
      "CarScanr",
      "Identify any vehicle from a single photo.",
      "CarScanr is now available on the App Store.",
      "https://apps.apple.com/us/app/carscanr/id6761960201",
      "How CarScanr Works",
      "See CarScanr in action",
      "Ready to identify your next vehicle?",
    ],
  },
  { path: "support/index.html", required: ["CarScanr Support", "support@carscanr.com", "1-2 business days"] },
  { path: "privacy/index.html", required: ["CarScanr Privacy Policy", "support@carscanr.com"] },
  { path: "terms/index.html", required: ["CarScanr Terms of Service", "support@carscanr.com"] },
];

const requiredAssets = [
  "styles.css",
  "assets/logo.png",
  "assets/screenshots/scan.png",
  "assets/screenshots/details.png",
  "assets/screenshots/value-listings.png",
  "assets/screenshots/garage.png",
];
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

const homeHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (/Coming soon/i.test(homeHtml)) {
  throw new Error("Homepage still contains coming soon messaging.");
}

if (missing.length > 0) {
  throw new Error(`Missing site files: ${missing.join(", ")}`);
}

console.log("Static site validation passed for /, /support, /privacy, and /terms.");
