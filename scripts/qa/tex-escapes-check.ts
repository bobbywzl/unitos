import { repairJsonEscapes, restoreControlEscapes, restoreTexEscapes, restoreTexEscapesDeep } from "@/lib/tex-escapes";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

// The silent cases: a backslash the JSON read as a control character.
check("tab in $\\text$", restoreTexEscapes(JSON.parse('"$\\text{Bank}_1$ (money)"')), "$\\text{Bank}_1$ (money)");
check("backspace in $\\beta$", restoreTexEscapes(JSON.parse('"$\\beta_1 + \\frac{a}{b}$"')), "$\\beta_1 + \\frac{a}{b}$");
check("newline in $\\nu$, CR in $\\rho$", restoreTexEscapes(JSON.parse('"$\\nu \\rho$"')), "$\\nu \\rho$");
check("a table's tabs stay", restoreTexEscapes("price\t$5\tqty"), "price\t$5\tqty");
check("a list's newlines stay", restoreTexEscapes("- one\n- two $x$"), "- one\n- two $x$");
check("no dollar: untouched", restoreTexEscapes("a\tb"), "a\tb");
check("fragment find", restoreControlEscapes(JSON.parse('"\\text{Bank}_1"')), "\\text{Bank}_1");
check("deep", restoreTexEscapesDeep({ ops: [{ find: JSON.parse('"$\\text{x}$"'), text: "y" }] }), { ops: [{ find: "$\\text{x}$", text: "y" }] });

// The loud case: an escape JSON does not know.
check("\\mathrm parses after repair", JSON.parse(repairJsonEscapes('{"t": "$\\mathrm{Bank}_1$"}')), { t: "$\\mathrm{Bank}_1$" });
check("\\upsilon parses after repair", JSON.parse(repairJsonEscapes('"\\upsilon"')), "\\upsilon");
check("\\u00e9 stays a unicode escape", JSON.parse(repairJsonEscapes('"caf\\u00e9"')), "café");
check("valid escapes stay", JSON.parse(repairJsonEscapes('"a\\nb\\t\\"q\\" \\\\ \\/"')), 'a\nb\t"q" \\ /');
check("already escaped TeX stays", JSON.parse(repairJsonEscapes('"$\\\\frac{a}{b}$"')), "$\\frac{a}{b}$");

console.log(failed === 0 ? "all checks pass" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
