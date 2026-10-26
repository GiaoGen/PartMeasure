/** A labelled product illustration, never a live project or an inferred measurement. */
export function ProductPreview() {
	return (
		<figure className="pm-workflow-preview">
			<svg
				viewBox="0 0 666 421"
				role="img"
				aria-label="工程资料工作台示意：照片标注、人工尺寸和客户补充，均为示例数据"
				style={{ fontFamily: "var(--pm-font)" }}
			>
				<rect width="666" height="421" rx="8" fill="var(--pm-surface)" />
				<path d="M0 44h666" stroke="var(--pm-line)" />
				<g fontSize="13">
					<text x="22" y="28" fill="var(--pm-accent)" fontWeight="600">
						资料与补测
					</text>
					<text x="144" y="28" fill="var(--pm-muted)">
						交付与版本
					</text>
				</g>
				<rect
					x="16"
					y="60"
					width="468"
					height="342"
					rx="6"
					fill="var(--pm-soft)"
				/>
				<g transform="translate(4 58) scale(.82)">
					<ellipse
						cx="294"
						cy="323"
						rx="181"
						ry="30"
						fill="#8091a0"
						opacity=".25"
					/>
					<path
						d="M111 214 150 129Q164 100 204 96H377Q410 103 429 132L473 236Q481 267 446 293L339 343Q311 357 282 342L135 277Q104 258 111 214"
						fill="#a6b2bc"
						stroke="#738391"
						strokeWidth="2"
					/>
					<path
						d="M111 207 151 121Q164 94 204 90H377Q410 96 429 126L473 229Q480 255 445 278L339 329Q311 343 282 328L135 264Q104 246 111 207"
						fill="#c4ced6"
						stroke="#81919e"
						strokeWidth="2"
					/>
					<ellipse
						cx="292"
						cy="202"
						rx="113"
						ry="77"
						fill="#dde4e9"
						stroke="#8595a3"
						strokeWidth="3"
					/>
					<ellipse
						cx="292"
						cy="205"
						rx="64"
						ry="43"
						fill="#5a6c7b"
						stroke="#687d8d"
						strokeWidth="5"
					/>
					{[
						[182, 159],
						[391, 162],
						[164, 238],
						[408, 241],
						[296, 297],
					].map(([x, y]) => (
						<ellipse
							key={`${x}:${y}`}
							cx={x}
							cy={y}
							rx="13"
							ry="9"
							fill="#536878"
						/>
					))}
					<ellipse
						cx="292"
						cy="205"
						rx="69"
						ry="47"
						fill="none"
						stroke="#2459b8"
						strokeWidth="3"
					/>
					<path
						d="M348 177 414 111h73"
						fill="none"
						stroke="#2459b8"
						strokeWidth="2"
					/>
					<circle cx="503" cy="111" r="16" fill="#2459b8" />
					<text x="498" y="116" fontSize="15" fill="#fff">
						1
					</text>
				</g>
				<path d="M502 60v342" stroke="var(--pm-line)" />
				<g fill="var(--pm-ink)">
					<text x="520" y="91" fontSize="15" fontWeight="600">
						1 中心孔
					</text>
					<text x="520" y="130" fontSize="12" fill="var(--pm-muted)">
						人工直径 Ø
					</text>
					<text x="520" y="162" fontSize="20" fontWeight="600">
						24.00 mm
					</text>
					<path d="M520 188h126" stroke="var(--pm-line)" />
					<text x="520" y="220" fontSize="14" fontWeight="600">
						客户补充
					</text>
					<text x="520" y="248" fontSize="12" fill="var(--pm-muted)">
						来源与历史保留
					</text>
					<text x="520" y="301" fontSize="13">
						› 测量要求
					</text>
					<text x="520" y="344" fontSize="13">
						› 修订历史
					</text>
				</g>
			</svg>
			<figcaption>产品流程示意 · 示例数据</figcaption>
		</figure>
	);
}
