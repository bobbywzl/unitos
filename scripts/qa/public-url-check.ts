// The public address guard (lib/public-url.ts): which addresses the server
// may fetch for a reader's link or a page's own stylesheets and images.
// Run: npx tsx scripts/qa/public-url-check.ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { PublicUrlError, assertPublicUrl, isPrivateAddress, publicFetch, publicLookup } from "@/lib/public-url";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

const PRIVATE = [
  "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.9.9.9", "169.254.169.254", "172.16.0.1", "172.31.255.255",
  "192.168.1.1", "192.0.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::", "::1", "[::1]", "fc00::1", "fd12:3456::1",
  "fe80::1", "fe80::1%eth0", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1",
  "2002:7f00:1::1", "2001:db8::1", "not an address",
];
const PUBLIC = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "198.17.0.1",
  "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"];
for (const ip of PRIVATE) check(`private ${ip}`, isPrivateAddress(ip), true);
for (const ip of PUBLIC) check(`public ${ip}`, isPrivateAddress(ip), false);

const refusal = async (url: string) => {
  try {
    await assertPublicUrl(url);
    return "allowed";
  } catch (err) {
    return err instanceof PublicUrlError ? err.refusal : `threw ${String(err)}`;
  }
};

async function main() {
  const REFUSED: [string, string][] = [
    ["ftp://example.com/file.txt", "scheme"], ["file:///etc/passwd", "scheme"], ["javascript:alert(1)", "scheme"], ["not a url", "scheme"],
    ["http://localhost:3399/", "private"], ["http://LOCALHOST/", "private"], ["http://app.localhost/", "private"],
    ["http://127.0.0.1:5432/", "private"], ["http://[::1]:3111/", "private"], ["http://169.254.169.254/latest/meta-data/", "private"],
    ["http://10.0.0.8/", "private"], ["http://192.168.0.1/admin", "private"], ["http://0/", "private"], ["http://2130706433/", "private"],
    ["http://0x7f.1/", "private"], ["http://printer.local/", "private"], ["http://db.internal/", "private"], ["http://intranet/", "private"],
    ["http://[::ffff:127.0.0.1]/", "private"], ["http://user:pass@127.0.0.1/", "private"], ["http://127.0.0.1./", "private"],
  ];
  for (const [url, want] of REFUSED) check(`refuse ${url}`, await refusal(url), want);
  check("allow a public address", await refusal("https://93.184.216.34/page"), "allowed");
  check("allow a name that does not resolve here", await refusal("https://this-name-does-not-resolve.example/"), "allowed");

  // The socket's own lookup: a name that answers with a private address is refused.
  const lookedUp = await new Promise<string>((resolve) => {
    publicLookup()("localhost", { all: true }, (err) => resolve(err ? (err.code ?? "error") : "allowed"));
  });
  check("lookup refuses localhost", lookedUp, "EPRIVATE");

  // The undici plumbing, against a server on this machine: with the guard
  // the connection is refused; with a lookup that refuses nothing the same
  // request answers. So the guard, not the wiring, is what refuses.
  const server = createServer((_, res) => res.end("here")).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const through = async (agent: Agent) => {
    try {
      const res = await undiciFetch(`http://localhost:${port}/`, { dispatcher: agent, redirect: "manual" });
      return await res.text();
    } catch (err) {
      const cause = err instanceof Error ? (err.cause as NodeJS.ErrnoException | undefined) : undefined;
      return cause?.code ?? "error";
    }
  };
  check("agent with the guard refuses", await through(new Agent({ connect: { lookup: publicLookup() } })), "EPRIVATE");
  check("agent with no guard answers", await through(new Agent({ connect: { lookup: publicLookup(() => false) } })), "here");
  const fetched = await publicFetch(`http://localhost:${port}/`).then(
    () => "allowed",
    (err: unknown) => (err instanceof PublicUrlError ? err.refusal : "error"),
  );
  check("publicFetch refuses this machine", fetched, "private");
  server.close();

  console.log(failed ? `\n${failed} failed` : "\nall ok");
  process.exit(failed ? 1 : 0);
}

void main();
