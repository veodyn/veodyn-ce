// Spec 6.5: a non-admin gets the list and the detail page with create, edit,
// delete and publish ABSENT rather than disabled, plus this sentence. A
// disabled control implies a permission you might acquire by trying; absence
// on its own just looks like a page that is missing something. The sentence is
// what turns it into a stated arrangement.
//
// One constant, four call sites (list, detail, create, edit), so the four
// cannot drift into four slightly different explanations of the same rule.
export const ADMINISTERED_NOTE =
  'Publishing is administered. An administrator declares what this instance serves.'

export function AdministeredNote() {
  return <p className="text-sm text-muted-foreground">{ADMINISTERED_NOTE}</p>
}
