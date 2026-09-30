// The typography plugin writes two of its selectors as attributes:
// [class~="not-prose"] and [class~="lead"]. An attribute selector makes the
// browser restyle every element under an element whose class attribute
// changes: the page editor's text changes its class on each focus and on
// each figure it selects, and a long import took 100 ms to restyle. This
// plugin writes them as classes (.not-prose, .lead), which match the same
// elements.
module.exports = () => ({
  postcssPlugin: "unitos-class-selectors",
  Rule(rule) {
    if (!rule.selector.includes("[class~=")) return;
    rule.selector = rule.selector.replace(/\[class~=(["']?)([\w-]+)\1\]/g, ".$2");
  },
});
module.exports.postcss = true;
