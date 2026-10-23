/** Static help only: example numbers never populate measurements or engineering fields. */
export type CaliperMethod = "outside" | "inside" | "depth";
export type ReadingKind = "digital" | "vernier";
export type HelpArticle = {
	title: string;
	image: string;
	imageAlt: string;
	steps: readonly string[];
	note: string;
};

export const caliperPreparation = "先擦净测量面，轻合外测量爪检查零位。零位异常或工具不适用时，请说明情况并上传照片。";
export const measurementHelpFallback = "看不清读数可直接上传测量照片；没有合适工具时可选择“无法测量”。";

export const caliperMethods: Record<CaliperMethod, HelpArticle> = {
	outside: {
		title: "外测量爪：夹住两侧外表面",
		image: "/measurement-help/outside.svg",
		imageAlt: "卡尺的大爪轻夹零件两侧外表面，蓝色位置表示两个接触面。",
		steps: [
			"按标注和工程师说明，找到要测的两侧外表面。",
			"用较大的外测量爪轻轻夹住，尽量靠近爪根，保持卡尺与被测方向对正。",
			"两面贴合、零件不歪斜后保持位置，读取数值或拍照。",
		],
		note: "不要夹在毛刺或倒角上，也不要用力挤压零件。示意图只说明接触方式，实际位置以标注为准。",
	},
	inside: {
		title: "内测量爪：轻贴孔内两侧",
		image: "/measurement-help/inside.svg",
		imageAlt: "卡尺的小爪伸入内孔，向外轻贴两侧内壁；此图为接触位置剖面示意。",
		steps: [
			"使用较小的内测量爪，伸入工程师指定的孔或槽，避开孔口倒角。",
			"轻轻向外展开，让两个测量面贴住内壁，不要斜着撑紧。",
			"测圆孔直径时，在同一深度对正孔中心，轻移寻找最大稳定读数；测槽宽时对正两壁，取最小稳定读数。",
		],
		note: "斜拍照片上的椭圆不代表要量两个轴；若本项要求孔径，按工程师指定位置测实际孔径。小爪放不进去时可说明无法测量。",
	},
	depth: {
		title: "深度杆：基准面贴平，杆端触底",
		image: "/measurement-help/depth.svg",
		imageAlt: "卡尺尾端基准面贴住孔口平面，细深度杆垂直伸到孔底，蓝色括线表示深度。",
		steps: [
			"找到卡尺尾端伸出的细深度杆，确认要测的孔底或台阶底面。",
			"让尾端基准面贴平指定的孔口表面，保持杆与底面垂直。",
			"缓慢伸杆至杆端轻触底面，保持基准面不翘起，再读数或拍照。",
		],
		note: "注意杆端不要顶在侧壁、碎屑或圆角上。通孔没有封闭孔底，不能直接按此图当盲孔测深；请按工程师说明选择基准。",
	},
};

export const caliperReadings: Record<ReadingKind, HelpArticle> = {
	digital: {
		title: "数显卡尺怎么读",
		image: "/measurement-help/digital.svg",
		imageAlt: "数显屏示例显示 12.35 mm；需要同时核对数字、小数点和屏幕单位。",
		steps: [
			"测量前闭合外爪核对零位，不要夹着零件按归零。",
			"贴合零件后，直接读屏幕上的完整数字，同时看清 mm 或 in；填写区选择相同单位。",
			"拍照时让完整显示屏和接触位置清楚可见；一张拍不清可分别补两张。",
		],
		note: "图中 12.35 mm 只是读数示例，不是本项尺寸；显示位数不等于测量准确度。不要把屏幕英寸数当作毫米填写。",
	},
	vernier: {
		title: "游标卡尺怎么读",
		image: "/measurement-help/vernier.svg",
		imageAlt: "0.05 mm 分度值示例：游标零线位于主尺 12 与 13 mm 之间，第 7 条游标刻线与主尺刻线对齐，结果为 12 加 7 乘 0.05，等于 12.35 mm。",
		steps: [
			"先看卡尺标出的分度值，例如 0.02 mm 或 0.05 mm；不要把不同卡尺的分度值混用。",
			"正对刻线，读游标零线左侧最近的主尺毫米数；示例是 12 mm。",
			"从游标零线起，找与主尺最重合的刻线，数第几格；用主尺读数＋格数×分度值。示例：12＋7×0.05＝12.35 mm。",
		],
		note: "图中为 0.05 mm 分度值、每格 1 mm 的主尺示例。游标上的印字不一定就是格数；看不准或零线不对齐时，上传清晰的主尺／游标照片，不要猜数。",
	},
};

// Unknown/unassigned methods never become a guessed caliper recommendation.
export function caliperHelp(method: string | undefined | null): HelpArticle | null {
	return method === "outside" || method === "inside" || method === "depth"
		? caliperMethods[method]
		: null;
}
