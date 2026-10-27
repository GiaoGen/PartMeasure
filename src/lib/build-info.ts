// Next embeds this public source fingerprint at build time; no credentials enter it.
export const buildId = process.env.PM_BUILD_ID ?? "unbuilt";
