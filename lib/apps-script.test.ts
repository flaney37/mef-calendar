import { describe, expect, it } from "vitest";
import { appsScriptSource, GMAIL_QUERY } from "./apps-script";

const token = "TESTvolunteerToken00000000000000";
const source = appsScriptSource({ apiUrl: "https://mef-calendar.vercel.app/api/ingest", token });

// The script's own helper, run here: the source must parse as plain JS, and
// stripNames must not need any Apps Script global.
const stripNames = new Function(`${source}\nreturn stripNames;`)() as (text: string) => string;

describe("appsScriptSource", () => {
  it("is valid JavaScript with the token and address filled in once", () => {
    expect(() => new Function(source)).not.toThrow();
    expect(source.split(token)).toHaveLength(2);
    expect(source).toContain('var API_URL = "https://mef-calendar.vercel.app/api/ingest";');
    expect(source).toContain("function setup()");
    expect(source).toContain('everyMinutes(10)');
  });

  it("searches only recent, unsent MEF / Blackboard mail", () => {
    expect(GMAIL_QUERY).toContain("newer_than:3d");
    expect(GMAIL_QUERY).toContain("-label:mef-calendar");
    expect(GMAIL_QUERY).toContain("{from:mef.blackboard.com from:mef.edu.tr}");
  });
});

describe("stripNames (runs in the volunteer's Gmail before sending)", () => {
  it.each([
    ["Merhaba YİĞİT KÖKOĞLU size bir mesaj gönderdi.", "Merhaba."],
    ["Dear Ayşe Yılmaz,\nThe lab is cancelled.", "Dear,\nThe lab is cancelled."],
    ["Sayın Ahmet Demir, yarınki ders yok.", "Sayın, yarınki ders yok."],
  ])("cuts the name: %s", (input, output) => {
    expect(stripNames(input)).toBe(output);
  });

  it.each([
    "Dear COMP 201 Students,",
    "Dear Students,",
    "Dear all,",
    "Hi everyone,",
    "Değerli Öğrencilerim,",
    "Merhaba arkadaşlar,",
    "This is the link for the online lecture.",
  ])("keeps: %s", (text) => {
    expect(stripNames(text)).toBe(text);
  });
});
