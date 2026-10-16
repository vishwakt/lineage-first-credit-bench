// Reason-code dictionaries published by the fictional bureaus. All codes and texts are
// invented for this benchmark. A dictionary version takes effect on its effective date;
// a bureau emits codes from the version in force, and an adapter maps codes to texts with
// the version it has loaded. Version changes are the "reference-data drift" events.

export type Factor =
  | "DELINQ_RECENT"
  | "DELINQ_SEVERE"
  | "HIGH_UTIL"
  | "SHORT_HISTORY"
  | "FEW_ACCOUNTS"
  | "HIGH_BALANCE"
  | "NO_REVOLVING";

export type ReasonDictionary = {
  bureau: string;
  version: string;
  effective: string;
  codes: Record<Factor, { code: string; text: string }>;
};

export const REASON_DICTIONARIES: Record<string, readonly ReasonDictionary[]> = {
  bureau_a: [
    {
      bureau: "bureau_a",
      version: "a.1",
      effective: "2020-01-01",
      codes: {
        DELINQ_RECENT: { code: "A01", text: "Recent late payment on one or more accounts" },
        DELINQ_SEVERE: { code: "A02", text: "Serious delinquency reported" },
        HIGH_UTIL: { code: "A04", text: "Revolving balances are high relative to limits" },
        SHORT_HISTORY: { code: "A07", text: "Length of credit history is short" },
        FEW_ACCOUNTS: { code: "A09", text: "Too few accounts currently paid as agreed" },
        HIGH_BALANCE: { code: "A11", text: "Total balances on accounts are high" },
        NO_REVOLVING: { code: "A12", text: "No recent revolving account activity" },
      },
    },
    {
      bureau: "bureau_a",
      version: "a.2",
      effective: "2025-06-01",
      codes: {
        DELINQ_RECENT: { code: "A21", text: "Time since most recent delinquency is too short" },
        DELINQ_SEVERE: { code: "A02", text: "Serious delinquency or derogatory record reported" },
        HIGH_UTIL: { code: "A14", text: "Proportion of revolving balances to limits is too high" },
        SHORT_HISTORY: { code: "A04", text: "Age of oldest account is too low" },
        FEW_ACCOUNTS: { code: "A09", text: "Number of accounts paid as agreed is too low" },
        HIGH_BALANCE: { code: "A11", text: "Amount owed on accounts is too high" },
        NO_REVOLVING: { code: "A07", text: "Lack of recent revolving account information" },
      },
    },
  ],
  bureau_b: [
    {
      bureau: "bureau_b",
      version: "b.1",
      effective: "2020-01-01",
      codes: {
        DELINQ_RECENT: { code: "014", text: "Delinquency in the last 12 months" },
        DELINQ_SEVERE: { code: "018", text: "Account 90 or more days past due" },
        HIGH_UTIL: { code: "010", text: "High revolving utilization" },
        SHORT_HISTORY: { code: "021", text: "Limited credit history" },
        FEW_ACCOUNTS: { code: "027", text: "Insufficient number of satisfactory accounts" },
        HIGH_BALANCE: { code: "030", text: "High outstanding balances" },
        NO_REVOLVING: { code: "032", text: "No open revolving accounts" },
      },
    },
    {
      bureau: "bureau_b",
      version: "b.2",
      effective: "2025-08-15",
      codes: {
        DELINQ_RECENT: { code: "014", text: "One or more accounts delinquent within 12 months" },
        DELINQ_SEVERE: { code: "018", text: "Account seriously past due" },
        HIGH_UTIL: { code: "010", text: "Revolving utilization is too high" },
        SHORT_HISTORY: { code: "021", text: "Credit history is too recent" },
        FEW_ACCOUNTS: { code: "027", text: "Too few satisfactory accounts" },
        HIGH_BALANCE: { code: "030", text: "Outstanding balances are too high" },
        NO_REVOLVING: { code: "032", text: "No open revolving accounts" },
      },
    },
  ],
  bureau_c: [
    {
      bureau: "bureau_c",
      version: "c.1",
      effective: "2020-01-01",
      codes: {
        DELINQ_RECENT: { code: "DLQ_RECENT", text: "Recent delinquency" },
        DELINQ_SEVERE: { code: "DLQ_SEVERE", text: "Severe delinquency" },
        HIGH_UTIL: { code: "UTIL_HIGH", text: "High utilization of available credit" },
        SHORT_HISTORY: { code: "HIST_SHORT", text: "Short credit history" },
        FEW_ACCOUNTS: { code: "ACCT_FEW", text: "Few satisfactory accounts" },
        HIGH_BALANCE: { code: "BAL_HIGH", text: "High balances" },
        NO_REVOLVING: { code: "REV_NONE", text: "No revolving accounts" },
      },
    },
  ],
};

export function dictionaryVersion(bureau: string, version: string): ReasonDictionary {
  const d = REASON_DICTIONARIES[bureau]?.find((x) => x.version === version);
  if (!d) throw new Error(`unknown dictionary ${bureau} ${version}`);
  return d;
}

export function textFor(dict: ReasonDictionary, code: string): string | null {
  for (const entry of Object.values(dict.codes)) if (entry.code === code) return entry.text;
  return null;
}
