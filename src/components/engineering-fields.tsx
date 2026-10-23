"use client";
import { useId, type ReactNode } from "react";
import {
	type AnnotationDraft,
	type EngineeringMetadata,
	typeLabel,
} from "@/lib/annotations";
import {
	annotationStatus,
	requiredMeasurements,
	measurementFieldLabel,
} from "@/lib/annotation-collaboration";
import { annotationColor } from "@/lib/annotation-presentation";
import { methodLabel } from "@/lib/issues";
import { MeasurementHelp } from "./measurement-help";

function Field({
	id,
	label,
	children,
}: {
	id: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="engineering-field">
			<label htmlFor={id}>{label}</label>
			<div className="engineering-control">{children}</div>
		</div>
	);
}

export function EngineeringFields({
	item,
	disabled,
	onChange,
	onBlur,
	number,
}: {
	item: AnnotationDraft;
	disabled: boolean;
	onChange: (item: AnnotationDraft, group: string) => void;
	onBlur: () => void;
	number?: number;
}) {
	const prefix = useId();
	const id = (key: string) => `${prefix}-${key}`;
	const set = (key: keyof EngineeringMetadata, value: string) =>
		onChange(
			{
				...item,
				metadata: {
					...item.metadata,
					[key]: value,
					...(key === "measurementMode" &&
					item.geometry.type === "point" &&
					value !== "required"
						? { dimension: "" }
						: {}),
				},
			},
			`${item.id}:${key}`,
		);
	const quantities = requiredMeasurements({
		...item,
		metadata: {
			...item.metadata,
			measurementMode:
				item.geometry.type === "point" ? item.metadata.measurementMode : "auto",
		},
	}).filter((field) => field !== "holeDepth");
	const firstLength = quantities.find((field) => field !== "angleValue");
	const needsMeasurement =
		item.geometry.type !== "text" && item.metadata.measurementMode !== "none";
	const status =
		annotationStatus(item) ||
		(requiredMeasurements(item).length ? "已填写" : "仅说明");
	const method = item.metadata.measurementMethod ?? "unspecified";
	const noteSummary = [
		needsMeasurement && method !== "unspecified" ? methodLabel[method] : "",
		item.metadata.notes.trim() ? "有备注" : "",
	]
		.filter(Boolean)
		.join(" · ");
	const numeric = (
		field:
			| "dimension"
			| "angleValue"
			| "arcLength"
			| "majorRadius"
			| "holeDepth",
	) => (
		<input
			id={id(field)}
			inputMode="decimal"
			maxLength={24}
			placeholder={
				item.collaboration?.values?.[field]
					? "留空采用客户回复"
					: "留空则自动提示客户补充"
			}
			value={item.metadata[field] ?? ""}
			onChange={(e) => {
				if (
					e.target.value === "" ||
					/^(?:0|[1-9]\d{0,8})(?:\.\d{0,6})?$/.test(e.target.value)
				)
					set(field, e.target.value);
			}}
		/>
	);
	return (
		<fieldset
			disabled={disabled}
			className="engineering-fields"
			onBlur={onBlur}
		>
			<legend>
				<span>
					{number ? `${number} · ` : ""}
					{typeLabel(item.geometry)}属性
				</span>
				<small className="engineering-status" style={{ color: annotationColor(item) }}>{status}</small>
			</legend>
			<div className="engineering-core">
				<Field id={id("name")} label="名称">
					<input
						id={id("name")}
						maxLength={120}
						value={item.metadata.name}
						onChange={(e) => set("name", e.target.value)}
					/>
				</Field>
				{item.geometry.type === "text" ? (
					<Field id={id("text")} label="标注文字">
						<textarea
							id={id("text")}
							maxLength={500}
							value={item.geometry.text}
							onChange={(e) => {
								if (item.geometry.type === "text")
									onChange(
										{
											...item,
											geometry: { ...item.geometry, text: e.target.value },
										},
										`${item.id}:text`,
									);
							}}
						/>
					</Field>
				) : (
					<Field id={id("purpose")} label="标注用途">
						<select
							id={id("purpose")}
							value={item.metadata.measurementMode ?? "auto"}
							onChange={(e) => set("measurementMode", e.target.value)}
						>
							<option value="auto">
								{item.geometry.type === "point" ? "位置说明" : "补齐尺寸"}
							</option>
							{item.geometry.type === "point" ? (
								<option value="required">需要补充尺寸</option>
							) : null}
							<option value="none">仅说明，无需补充</option>
						</select>
					</Field>
				)}
				{item.geometry.type === "ellipse" ? (
					<Field id={id("ellipseMeasure")} label="尺寸含义">
						<select
							id={id("ellipseMeasure")}
							value={item.metadata.ellipseMeasure ?? "diameter"}
							onChange={(e) => set("ellipseMeasure", e.target.value)}
						>
							<option value="diameter">圆孔直径 Ø（默认）</option>
							<option value="majorRadius">长半轴 a</option>
						</select>
					</Field>
				) : null}
				{item.geometry.type === "circle" ? (
					<Field id={id("circleMeasure")} label="尺寸含义">
						<select
							id={id("circleMeasure")}
							value={item.metadata.circleMeasure}
							onChange={(e) => set("circleMeasure", e.target.value)}
						>
							<option value="diameter">直径 Ø</option>
							<option value="radius">半径 R</option>
						</select>
					</Field>
				) : null}
				{item.geometry.type === "arc" ? (
					<fieldset className="engineering-quantities">
						<legend>测量项目</legend>
						<div className="engineering-checks">
							{(["radius", "arcLength", "angle"] as const).map((q) => {
								const old = item.metadata.arcQuantities ?? ["radius"];
								return (
									<label key={q}>
										<input
											type="checkbox"
											checked={old.includes(q)}
											disabled={old.length === 1 && old.includes(q)}
											onChange={(e) =>
												onChange(
													{
														...item,
														metadata: {
															...item.metadata,
															arcQuantities: e.target.checked
																? [...old, q]
																: old.filter((v) => v !== q),
														},
													},
													`${item.id}:arcQuantities`,
												)
											}
										/>
										<span>
											{q === "radius"
												? "半径"
												: q === "arcLength"
													? "弧长"
													: "圆心角"}
										</span>
									</label>
								);
							})}
						</div>
					</fieldset>
				) : null}
				{quantities.map((field) => (
					<Field
						key={field}
						id={id(field)}
						label={`人工${measurementFieldLabel(item, field)}`}
					>
						<div className="engineering-value-unit">
							{numeric(field)}
							{field === "angleValue" ? (
								<span className="engineering-unit">°</span>
							) : field === firstLength ? (
								<select
									aria-label="长度单位"
									value={item.metadata.unit}
									onChange={(e) => set("unit", e.target.value)}
								>
									{["mm", "cm", "m", "in"].map((unit) => (
										<option key={unit}>{unit}</option>
									))}
								</select>
							) : (
								<span className="engineering-unit">{item.metadata.unit}</span>
							)}
						</div>
					</Field>
				))}
				{item.geometry.type === "angle" ? (
					<div className="engineering-offset engineering-checks">
						<label>
							<input
								type="checkbox"
								checked={item.geometry.reflex}
								onChange={(e) => {
									if (item.geometry.type === "angle")
										onChange(
											{
												...item,
												geometry: {
													...item.geometry,
													reflex: e.target.checked,
												},
											},
											`${item.id}:reflex`,
										);
								}}
							/>
							<span>取反角</span>
						</label>
					</div>
				) : null}
				{item.geometry.type === "circle" ? (
					<details className="hole-properties engineering-offset">
						<summary>
							孔位属性<span>选填</span>
						</summary>
						<div className="engineering-core">
							<div className="engineering-checks">
								<label>
									<input
										type="checkbox"
										checked={item.metadata.requireHoleDepth ?? false}
										onChange={(e) =>
											onChange(
												{
													...item,
													metadata: {
														...item.metadata,
														requireHoleDepth: e.target.checked,
													},
												},
												`${item.id}:requireHoleDepth`,
											)
										}
									/>
									<span>需要补齐孔深</span>
								</label>
							</div>
							<Field id={id("holeDepth")} label="孔深">
								<div className="engineering-value-unit">
									{numeric("holeDepth")}
									<span className="engineering-unit">{item.metadata.unit}</span>
								</div>
							</Field>
							<Field id={id("holeType")} label="孔类型">
								<select
									id={id("holeType")}
									value={item.metadata.holeType}
									onChange={(e) => set("holeType", e.target.value)}
								>
									{Object.entries({
										"": "未指定",
										through: "通孔",
										blind: "盲孔",
										threaded: "螺纹孔",
										counterbore: "柱形沉孔",
										countersink: "锥形沉孔",
										other: "其他",
									}).map(([v, label]) => (
										<option value={v} key={v}>
											{label}
										</option>
									))}
								</select>
							</Field>
							<Field id={id("thread")} label="螺纹规格">
								<input
									id={id("thread")}
									maxLength={80}
									placeholder="如 M6 × 1"
									value={item.metadata.thread}
									onChange={(e) => set("thread", e.target.value)}
								/>
							</Field>
						</div>
					</details>
				) : null}
				{quantities.length ? (
					<p className="engineering-help">
						{Object.keys(item.collaboration?.values ?? {}).length
							? "留空时采用客户回复，不需要再次确认。"
							: "尺寸由人填写；留空则提示客户补充。"}
					</p>
				) : null}
			</div>
			<details className="engineering-guidance">
				<summary>
					<span>{needsMeasurement ? "测量要求与备注" : "备注"}</span>
					<small>{noteSummary}</small>
				</summary>
				<div className="engineering-core">
					{needsMeasurement ? (
						<>
							<Field id={id("method")} label="测量方式">
								<select
									id={id("method")}
									value={method}
									onChange={(e) => set("measurementMethod", e.target.value)}
								>
									{Object.entries(methodLabel).map(([key, label]) => (
										<option key={key} value={key}>
											{label}
										</option>
									))}
								</select>
							</Field>
							<MeasurementHelp
								method={method}
								field={firstLength ?? (item.metadata.requireHoleDepth ? "holeDepth" : "angleValue")}
							/>
							<Field id={id("instructions")} label="测量说明">
								<textarea
									id={id("instructions")}
									aria-label="测量说明（选填）"
									maxLength={2000}
									value={item.metadata.measurementInstructions ?? ""}
									placeholder="例如：测量两端外侧距离"
									onChange={(e) =>
										set("measurementInstructions", e.target.value)
									}
								/>
							</Field>
						</>
					) : null}
					<Field id={id("notes")} label="备注">
						<textarea
							id={id("notes")}
							maxLength={2000}
							value={item.metadata.notes}
							onChange={(e) => set("notes", e.target.value)}
						/>
					</Field>
				</div>
			</details>
		</fieldset>
	);
}
