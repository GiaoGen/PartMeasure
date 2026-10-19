"use client";
import {
	type AnnotationDraft,
	type EngineeringMetadata,
	typeLabel,
} from "@/lib/annotations";
export function EngineeringFields({
	item,
	disabled,
	onChange,
	onBlur,
}: {
	item: AnnotationDraft;
	disabled: boolean;
	onChange: (item: AnnotationDraft, group: string) => void;
	onBlur: () => void;
}) {
	const set = (key: keyof EngineeringMetadata, value: string) =>
		onChange(
			{ ...item, metadata: { ...item.metadata, [key]: value } },
			`${item.id}:${key}`,
		);
	return (
		<fieldset
			disabled={disabled}
			className="engineering-fields"
			onBlur={onBlur}
		>
			<legend>{typeLabel(item.geometry)}属性</legend>
			<label>
				名称
				<input
					maxLength={120}
					value={item.metadata.name}
					onChange={(e) => set("name", e.target.value)}
				/>
			</label>
			{item.geometry.type === "text" ? (
				<label>
					标注文字
					<textarea
						aria-label="标注文字"
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
				</label>
			) : null}
			{item.geometry.type === "line" || item.geometry.type === "circle" ? (
				<>
					{item.geometry.type === "circle" ? (
						<label>
							尺寸含义
							<select
								value={item.metadata.circleMeasure}
								onChange={(e) => set("circleMeasure", e.target.value)}
							>
								<option value="diameter">直径</option>
								<option value="radius">半径</option>
							</select>
						</label>
					) : null}
					<label>
						人工尺寸
						<input
							inputMode="decimal"
							placeholder="可留空"
							value={item.metadata.dimension}
							onChange={(e) => {
								if (
									e.target.value === "" ||
									/^(?:0|[1-9]\d{0,8})(?:\.\d{0,6})?$/.test(e.target.value)
								)
									set("dimension", e.target.value);
							}}
						/>
					</label>
					<label>
						单位
						<select
							value={item.metadata.unit}
							onChange={(e) => set("unit", e.target.value)}
						>
							{["mm", "cm", "m", "in"].map((unit) => (
								<option key={unit}>{unit}</option>
							))}
						</select>
					</label>
				</>
			) : null}
			{item.geometry.type === "circle" ? (
				<details className="hole-properties">
					<summary>孔位属性（选填）</summary>
					<label>
						孔深（{item.metadata.unit}）
						<input
							inputMode="decimal"
							value={item.metadata.holeDepth}
							onChange={(e) => {
								if (
									e.target.value === "" ||
									/^(?:0|[1-9]\d{0,8})(?:\.\d{0,6})?$/.test(e.target.value)
								)
									set("holeDepth", e.target.value);
							}}
						/>
					</label>
					<label>
						孔类型
						<select
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
					</label>
					<label>
						螺纹规格
						<input
							maxLength={80}
							placeholder="如 M6 × 1"
							value={item.metadata.thread}
							onChange={(e) => set("thread", e.target.value)}
						/>
					</label>
				</details>
			) : null}
			<label>
				备注
				<textarea
					aria-label="备注"
					maxLength={2000}
					value={item.metadata.notes}
					onChange={(e) => set("notes", e.target.value)}
				/>
			</label>
		</fieldset>
	);
}
