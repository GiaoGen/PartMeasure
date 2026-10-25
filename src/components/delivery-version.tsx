"use client";
import type { Delivery } from "@/lib/deliveries";
import { DeliveryDownload } from "./delivery-download";

export const deliverySizeLabel = (bytes: string) =>
	Number(bytes) < 1024
		? `${bytes} B`
		: Number(bytes) < 1024 * 1024
			? `${(Number(bytes) / 1024).toFixed(1)} KiB`
			: `${(Number(bytes) / 1024 / 1024).toFixed(2)} MiB`;

export function DeliveryContents({ delivery, base, onInvalid }: {
	delivery: Delivery;
	base: string;
	onInvalid: () => void;
}) {
	return <>
		<p className="preserve-lines">{delivery.description || "未填写版本说明"}</p>
		<ul className="delivery-file-list">
			{delivery.files.map(file => <li key={file.id}>
				<div>
					<strong>{file.filename}</strong>
					<small>{file.mime} · {deliverySizeLabel(file.byteSize)}</small>
				</div>
				<DeliveryDownload base={base} deliveryId={delivery.id} file={file} onInvalid={onInvalid} />
			</li>)}
		</ul>
	</>;
}
