import { findVolunteer, insertMailEvents, recordMail, touchVolunteer, volunteerContext } from "@/lib/db/ingest";
import { dedupeKey, hashToken, ingestSchema, planIngest, senderAllowed } from "@/lib/ingest-plan";
import { TOKEN_PATTERN, truncateToken } from "@/lib/token";

// Called by a volunteer's Gmail script (apps-script/) for each new MEF
// announcement: `Authorization: Bearer <volunteer token>`, JSON body
// { messageId, from, subject, body, sentAt }.
//
// The response says only what happened ({ status, events }), never the
// mail's content. The body itself is not stored or logged anywhere.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!token || !TOKEN_PATTERN.test(token)) return Response.json({ error: "unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = ingestSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const input = parsed.data;

  try {
    const volunteer = await findVolunteer(hashToken(token));
    if (!volunteer) return Response.json({ error: "unauthorized" }, { status: 401 });
    await touchVolunteer(volunteer.id);

    // Not from MEF: drop it without a trace (no row, no subject).
    if (!senderAllowed(input.from)) return Response.json({ status: "ignored", events: 0 });

    const context = await volunteerContext(volunteer.studentId, volunteer.semesterId);
    const plan = planIngest(input, {
      semester: { startDate: volunteer.startDate, endDate: volunteer.endDate, holidays: volunteer.holidays },
      ...context,
    });

    const mailId = await recordMail({
      dedupeKey: dedupeKey(input),
      volunteerId: volunteer.id,
      sentAt: new Date(input.sentAt),
      subject: plan.keepSubject ? input.subject.slice(0, 300) : null,
      outcome: plan.outcome,
      reason: plan.reason,
    });
    if (mailId === null) return Response.json({ status: "duplicate", events: 0 });

    const added = await insertMailEvents(volunteer.semesterId, mailId, plan.events);
    return Response.json({ status: plan.outcome, events: added });
  } catch (error) {
    console.error(`ingest ${truncateToken(token)}: failed`, error);
    return Response.json({ error: "server error" }, { status: 500 });
  }
}
