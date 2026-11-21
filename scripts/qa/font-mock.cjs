// Sandbox only: Google Fonts stylesheets for next/font, served from a local
// font file. A sandbox proxy can rewrite the real font file URLs, which the
// font loader cannot read, and the production build then fails. Build with
//   NEXT_FONT_GOOGLE_MOCKED_RESPONSES=$PWD/scripts/qa/font-mock.cjs npx next build --webpack
// Any family and weights the app asks for get one face each. Never set this
// in a deploy: the pages would draw in the stand-in font.
/* eslint-disable @typescript-eslint/no-require-imports -- Next loads this file with require(), so it is CommonJS */
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "..", "..", "node_modules", "prisma", "build", "public", "assets");
const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => /^inter-latin-400-normal.*\.woff2$/.test(f)) : undefined;
if (!file) throw new Error("font-mock: no stand-in font under node_modules/prisma/build/public/assets");
const FILE = path.join(dir, file);

module.exports = new Proxy(
  {},
  {
    get(_, url) {
      if (typeof url !== "string" || !url.startsWith("http")) return undefined;
      const family = decodeURIComponent((/family=([^:&]+)/.exec(url) || [])[1] || "Mock").replace(/\+/g, " ");
      const weights = ((/wght@([0-9;.]+)/.exec(url) || [])[1] || "400").split(";");
      return weights
        .map(
          (w) =>
            `/* latin */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: ${w};\n  font-display: swap;\n  src: url(${FILE}) format('woff2');\n  unicode-range: U+0000-00FF;\n}\n`,
        )
        .join("");
    },
  },
);
