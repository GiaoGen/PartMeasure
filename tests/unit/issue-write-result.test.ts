import { describe, expect, it } from "vitest";
import { applyIssueWrite, type IssueDetail, type IssueResponse, type IssueWriteResult } from "../../src/lib/issues";

const issue = {
	id: "issue", revision: 1, state: "awaiting_response", updatedAt: "old",
	latestResponseId: null, responses: [], reviews: [],
} as unknown as IssueDetail;
const response: IssueResponse = { id: "reply", issueRevision: 1, kind: "numeric", value: "12.3", unit: "mm", body: "original", authorType: "guest", guestLabel: "", createdAt: "now", attachments: [] };
const result: IssueWriteResult = { issueId: "issue", revision: 2, state: "submitted", updatedAt: "now", response };

describe("authoritative mutation deltas", () => {
	it("shows the committed response without another detail read and retains prior history", () => {
		const updated = applyIssueWrite(issue, result);
		expect(updated).toMatchObject({ revision: 2, state: "submitted", latestResponseId: "reply", responses: [response] });
		expect(issue.responses).toEqual([]);
		const reviewed = applyIssueWrite(updated as IssueDetail, { issueId: "issue", revision: 3, state: "confirmed", updatedAt: "later",
			review: { id: "review", issueRevision: 2, responseId: "reply", decision: "confirm", value: "12.4", unit: "mm", source: "owner_manual", note: "manual correction", createdAt: "later" } });
		expect(reviewed?.responses[0]?.value).toBe("12.3");
		expect(reviewed?.reviews[0]?.value).toBe("12.4");
	});
	it("does not duplicate replayed replies or let an old replay downgrade a newer state", () => {
		const updated = applyIssueWrite(issue, result) as IssueDetail;
		expect(applyIssueWrite(updated, result)).toBe(updated);
		expect(applyIssueWrite({ ...updated, revision: 4, state: "confirmed" }, result)?.state).toBe("confirmed");
	});
	it("requires reload for old-server results, revision gaps, other issues and mismatched reviews", () => {
		expect(applyIssueWrite(issue, { state: "submitted", revision: 2 } as IssueWriteResult)).toBeNull();
		expect(applyIssueWrite(issue, { ...result, issueId: "other" })).toBeNull();
		expect(applyIssueWrite(issue, { ...result, revision: 3 })).toBeNull();
		expect(applyIssueWrite(issue, { ...result, response: { ...response, issueRevision: 9 } })).toBeNull();
	});
});
