"use client";
import type { Delivery } from "@/lib/deliveries";
import { DeliveryDownload } from "./delivery-download";
import { useState } from "react";
import { ZipPackageExport } from "./zip-package-export";
import { DeliveryFeedbackSection, type FeedbackDirtyHandler } from "./delivery-feedback";

export const deliverySizeLabel = (bytes: string) =>
	Number(bytes) < 1024
		? `${bytes} B`
		: Number(bytes) < 1024 * 1024
			? `${(Number(bytes) / 1024).toFixed(1)} KiB`
			: `${(Number(bytes) / 1024 / 1024).toFixed(2)} MiB`;

export function DeliveryContents({ delivery, base, onInvalid, guest, visible, onFeedbackDirty }: {
	delivery: Delivery;
	base: string;
	onInvalid: () => void;
	guest: boolean;
	visible: boolean;
	onFeedbackDirty: FeedbackDirtyHandler;
}) {
	const [zipOpen, setZipOpen] = useState(false);
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
		{delivery.state === "published" && delivery.files.length ? zipOpen ? <ZipPackageExport base={base} guest={guest} materialIds={[]} fixedDelivery={delivery} visible={visible} onInvalid={onInvalid} onClose={() => setZipOpen(false)} /> : <button type="button" onClick={() => setZipOpen(true)}>ZIP打包附件</button> : null}
		<DeliveryFeedbackSection key={`${base}:${delivery.id}`} base={base} deliveryId={delivery.id} versionNo={delivery.versionNo ?? 1} guest={guest} visible={visible} onInvalid={onInvalid} onDirty={onFeedbackDirty} />
	</>;
}
