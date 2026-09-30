import { join } from "node:path";

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // The typography plugin's attribute selectors as classes
    // (postcss.class-selectors.cjs). The path is absolute: the build does not
    // find the plugin by a relative one.
    [join(process.cwd(), "postcss.class-selectors.cjs")]: {},
  },
};

export default config;
