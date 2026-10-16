import "server-only";
import net from "node:net";
import { createReadStream } from "node:fs";
import { once } from "node:events";
import { AppError } from "../policy";
export async function scan(file: string) {
	const host = process.env.CLAMD_HOST,
		port = Number(process.env.CLAMD_PORT ?? 3310);
	if (!host) throw new AppError("SCANNER_NOT_CONFIGURED", 503);
	await new Promise<void>((resolve, reject) => {
		const socket = net.createConnection({ host, port });
		let reply = "";
		socket.setTimeout(60000, () =>
			socket.destroy(new AppError("SCAN_TIMEOUT", 503)),
		);
		socket.on("error", () => reject(new AppError("SCAN_UNAVAILABLE", 503)));
		socket.on("data", (chunk) => {
			reply += chunk.toString();
			if (reply.length > 4096) socket.destroy();
		});
		socket.on("end", () =>
			reply.trim().replace(/\0/g, "").endsWith(": OK")
				? resolve()
				: reject(
						new AppError(
							reply.includes("FOUND") ? "MALWARE_REJECTED" : "SCAN_INCOMPLETE",
							reply.includes("FOUND") ? 422 : 503,
						),
					),
		);
		socket.once("connect", () => {
			void (async () => {
				socket.write(Buffer.from("zINSTREAM\0"));
				for await (const chunk of createReadStream(file, {
					highWaterMark: 65536,
				})) {
					const size = Buffer.alloc(4);
					size.writeUInt32BE(chunk.length);
					if (!socket.write(Buffer.concat([size, chunk])))
						await once(socket, "drain");
				}
				socket.write(Buffer.alloc(4));
			})().catch(() => socket.destroy(new Error("SCAN_IO")));
		});
	});
}
