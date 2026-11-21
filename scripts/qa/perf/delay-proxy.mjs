// A TCP proxy that adds a fixed delay to every packet in both directions:
// emulates the network between a Vercel function and the Supabase pooler.
// Usage: node delay-proxy.mjs <listenPort> <targetPort> <oneWayMs>
import net from "node:net";
const [listen, target, ms] = process.argv.slice(2).map(Number);
net.createServer((client) => {
  const up = net.connect(target, "127.0.0.1");
  const pipe = (from, to) => {
    from.on("data", (chunk) => setTimeout(() => { if (!to.destroyed) to.write(chunk); }, ms));
    from.on("end", () => setTimeout(() => to.end(), ms));
    from.on("error", () => to.destroy());
  };
  pipe(client, up); pipe(up, client);
}).listen(listen, () => console.log(`delay proxy :${listen} -> :${target} +${ms}ms each way`));
