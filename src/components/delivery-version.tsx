"use client";
import type { Delivery } from "@/lib/deliveries";
import { DeliveryDownload } from "./delivery-download";
import { useState, useCallback, useEffect, useRef } from "react";
import { WorkspaceIcon } from "./workspace-ui";
import { DisclosureRegion } from "./disclosure-region";
import { useId } from "react";
import { ZipPackageExport } from "./zip-package-export";
import {
	DeliveryFeedbackSection,
	type FeedbackDirtyHandler,
} from "./delivery-feedback";

export const deliverySizeLabel = (bytes: string) =>
	Number(bytes) < 1024
		? `${bytes} B`
		: Number(bytes) < 1024 * 1024
			? `${(Number(bytes) / 1024).toFixed(1)} KiB`
			: `${(Number(bytes) / 1024 / 1024).toFixed(2)} MiB`;

export function DeliveryContents({
	delivery,
	base,
	onInvalid,
	guest,
	visible,
	onFeedbackDirty,
}: {
	delivery: Delivery;
	base: string;
	onInvalid: () => void;
	guest: boolean;
	visible: boolean;
	onFeedbackDirty: FeedbackDirtyHandler;
}) {
	const [zipOpen, setZipOpen] = useState(false);
	const zipRegion = useId();
	const activity = useRef({
		feedback: false,
		zip: false,
		downloads: new Set<string>(),
	});
	const callbacks = useRef(onFeedbackDirty);
	callbacks.current = onFeedbackDirty;
	const report = useCallback(() => {
		const current = activity.current;
		callbacks.current(
			delivery.id,
			current.feedback || current.zip || current.downloads.size > 0,
		);
	}, [delivery.id]);
	const feedbackChanged = useCallback(
		(_id: string, dirty: boolean) => {
			activity.current.feedback = dirty;
			report();
		},
		[report],
	);
	const zipChanged = useCallback(
		(busy: boolean) => {
			activity.current.zip = busy;
			report();
		},
		[report],
	);
	useEffect(() => () => callbacks.current(delivery.id, false), [delivery.id]);
	return (
		<>
			<p className="preserve-lines delivery-version-description">
				{delivery.description || "未填写版本说明"}
			</p>
			<header className="delivery-attachments-heading">
				<h4>
					版本附件 <small>{delivery.files.length} 份</small>
				</h4>
				{delivery.state === "published" && delivery.files.length ? (
					<button
						type="button"
						aria-expanded={zipOpen}
						aria-controls={zipRegion}
						onClick={() => setZipOpen(true)}
					>
						ZIP打包附件
					</button>
				) : null}
			</header>
			<ul className="delivery-file-list">
				{delivery.files.map((file) => (
					<li key={file.id}>
						<span className="delivery-file-icon">
							<WorkspaceIcon kind="file" />
						</span>
						<div className="delivery-file-name">
							<strong>{file.filename}</strong>
							<small>
								{file.mime === "image/webp"
									? "标准图 · WEBP"
									: file.filename.split(".").at(-1)?.toUpperCase() ||
										file.mime}{" "}
								· {deliverySizeLabel(file.byteSize)}
							</small>
						</div>
						<DeliveryDownload
							base={base}
							deliveryId={delivery.id}
							file={file}
							onInvalid={onInvalid}
							onBusyChange={(busy) => {
								if (busy) activity.current.downloads.add(file.id);
								else activity.current.downloads.delete(file.id);
								report();
							}}
						/>
					</li>
				))}
			</ul>
			<DisclosureRegion open={zipOpen} id={zipRegion}>
				<ZipPackageExport
					base={base}
					guest={guest}
					materialIds={[]}
					fixedDelivery={delivery}
					visible={visible && zipOpen}
					onBusyChange={zipChanged}
					onInvalid={onInvalid}
					onClose={() => setZipOpen(false)}
				/>
			</DisclosureRegion>
			<DeliveryFeedbackSection
				key={[base, delivery.id].join(":")}
				base={base}
				deliveryId={delivery.id}
				versionNo={delivery.versionNo ?? 1}
				guest={guest}
				visible={visible}
				onInvalid={onInvalid}
				onDirty={feedbackChanged}
			/>
		</>
	);
}
