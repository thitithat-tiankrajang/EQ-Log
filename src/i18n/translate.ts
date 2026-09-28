import { DEFAULT_LOCALE, type Locale } from "./locale";
import { en } from "./messages/en";
import { th } from "./messages/th";

/** The shape every catalogue must have: English's. */
export type Catalog = typeof en;

/** A message whose wording depends on `count`, chosen with `Intl.PluralRules`. */
export type PluralMessage = { readonly one?: string; readonly other: string };
type Message = string | PluralMessage;

type KeyPaths<T> = {
  [K in keyof T & string]: T[K] extends Message ? K : `${K}.${KeyPaths<T[K]>}`;
}[keyof T & string];

/** Every addressable message, as a dotted path such as `errors.generic`. */
export type MessageKey = KeyPaths<Catalog>;

export type MessageParams = Readonly<Record<string, string | number>>;

const CATALOGS: Readonly<Record<Locale, Catalog>> = { en, th };

function lookup(catalog: Catalog, key: string): Message | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === "string") return node;
  if (
    node !== null &&
    typeof node === "object" &&
    typeof (node as PluralMessage).other === "string"
  )
    return node as PluralMessage;
  return undefined;
}

/** Whether a key computed at run time (a server code, say) names a message. */
export function hasMessage(key: string): key is MessageKey {
  return lookup(CATALOGS[DEFAULT_LOCALE], key) !== undefined;
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Fill `{name}` placeholders and pick the plural form. Numbers are formatted for the locale. */
export function formatMessage(
  locale: Locale,
  message: Message,
  params: MessageParams = {},
): string {
  const count = params.count;
  const text =
    typeof message === "string"
      ? message
      : ((typeof count === "number" && new Intl.PluralRules(locale).select(count) === "one"
          ? message.one
          : undefined) ?? message.other);
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    if (value === undefined) return placeholder;
    return typeof value === "number" ? formatNumber(locale, value) : value;
  });
}

/**
 * The message for `key` in `locale`, falling back to English. A key that names
 * no message at all is returned as-is rather than throwing: a visible key is a
 * bug to fix, a crashed page is worse.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const message = lookup(CATALOGS[locale], key) ?? lookup(CATALOGS[DEFAULT_LOCALE], key);
  return message === undefined ? key : formatMessage(locale, message, params);
}
