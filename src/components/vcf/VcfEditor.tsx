import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import Icon from "@/components/ui/icon";

// ─── Types ───────────────────────────────────────────────────────────────────

interface VcfContact {
  id: string;
  fn: string;
  lastName: string;
  firstName: string;
  middleName: string;
  phones: string[];
  emails: string[];
  org: string;
  title: string;
  note: string;
  photo: string;      // base64 data-URI or ""
  photoType: string;  // JPEG / PNG / etc.
  birthday: string;
  address: string;
  url: string;
  extraFields: { key: string; value: string }[];
  raw: string[];
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function decodeQP(str: string): string {
  try {
    const joined = str.replace(/=\r?\n/g, "");
    const bytes = joined.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    return decodeURIComponent(escape(bytes));
  } catch {
    return str;
  }
}

function joinQPSoftBreaks(content: string): string {
  return content.replace(/=\r?\n/g, "");
}

function unfoldLines(raw: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    while (i + 1 < raw.length && /^[ \t]/.test(raw[i + 1])) {
      i++;
      line += raw[i].replace(/^[ \t]/, "");
    }
    result.push(line);
  }
  return result;
}

function getLineValue(line: string): string {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return "";
  const params = line.slice(0, colonIdx).toUpperCase();
  const value = line.slice(colonIdx + 1);
  if (params.includes("QUOTED-PRINTABLE")) return decodeQP(value);
  return value.trim();
}

function getFieldValue(lines: string[], keyPrefix: string): string {
  const upper = keyPrefix.toUpperCase();
  const line = lines.find((l) => l.toUpperCase().startsWith(upper));
  return line ? getLineValue(line) : "";
}

function getAllFieldValues(lines: string[], keyPrefix: string): string[] {
  const upper = keyPrefix.toUpperCase();
  return lines
    .filter((l) => l.toUpperCase().startsWith(upper))
    .map(getLineValue)
    .filter(Boolean);
}

// Known top-level keys we handle explicitly
const KNOWN_KEYS = new Set([
  "BEGIN", "END", "VERSION", "FN", "N", "TEL", "EMAIL",
  "ORG", "TITLE", "NOTE", "PHOTO", "BDAY", "ADR", "URL",
]);

function isKnownKey(line: string): boolean {
  const key = line.split(/[;:]/)[0].toUpperCase();
  return KNOWN_KEYS.has(key);
}

function parseVcf(content: string): VcfContact[] {
  const preprocessed = joinQPSoftBreaks(content);
  const blocks = preprocessed.split(/END:VCARD/i).filter((b) => b.trim());

  return blocks.map((block, i) => {
    const rawLines = block.split(/\r?\n/).filter((l) => l.trim());
    const lines = unfoldLines(rawLines);

    const fn = getFieldValue(lines, "FN");
    const nRaw = getFieldValue(lines, "N");
    const parts = nRaw.split(";");
    const lastName   = parts[0]?.trim() || "";
    const firstName  = parts[1]?.trim() || "";
    const middleName = parts[2]?.trim() || "";

    const phones  = getAllFieldValues(lines, "TEL");
    const emails  = getAllFieldValues(lines, "EMAIL");
    const org     = getFieldValue(lines, "ORG");
    const title   = getFieldValue(lines, "TITLE");
    const note    = getFieldValue(lines, "NOTE");
    const birthday = getFieldValue(lines, "BDAY");
    const url     = getFieldValue(lines, "URL");

    // ADR: ;TYPE=HOME:;;Street;City;State;ZIP;Country
    const adrRaw = getFieldValue(lines, "ADR");
    const adrParts = adrRaw.split(";");
    const address = adrParts.slice(2).filter(Boolean).join(", ");

    // PHOTO — may be inline base64 or URL
    const photoLine = lines.find((l) => l.toUpperCase().startsWith("PHOTO"));
    let photo = "";
    let photoType = "JPEG";
    if (photoLine) {
      const colonIdx = photoLine.indexOf(":");
      const params = photoLine.slice(0, colonIdx).toUpperCase();
      const value  = photoLine.slice(colonIdx + 1).trim();
      if (params.includes("BASE64") || params.includes("ENCODING=B") || params.includes("ENCODING=BASE64")) {
        const typeMatch = params.match(/TYPE=([A-Z]+)/);
        photoType = typeMatch ? typeMatch[1] : "JPEG";
        photo = `data:image/${photoType.toLowerCase()};base64,${value}`;
      } else if (value.startsWith("data:")) {
        photo = value;
      } else if (value.startsWith("http")) {
        photo = value;
      }
    }

    // Extra unknown fields
    const extraFields = lines
      .filter((l) => !isKnownKey(l) && !l.toUpperCase().startsWith("BEGIN") && !l.toUpperCase().startsWith("VERSION"))
      .map((l) => ({ key: l.split(/[;:]/)[0], value: getLineValue(l) }))
      .filter((f) => f.key && f.value);

    const displayName =
      fn ||
      `${lastName} ${firstName} ${middleName}`.trim() ||
      org ||
      phones[0] ||
      `Контакт ${i + 1}`;

    return {
      id: `contact-${i}`,
      fn: displayName,
      lastName, firstName, middleName,
      phones: phones.length > 0 ? phones : [""],
      emails,
      org, title, note, photo, photoType,
      birthday, address, url,
      extraFields,
      raw: rawLines,
    };
  });
}

function contactsToVcf(contacts: VcfContact[]): string {
  return contacts.map((c) => {
    const fn = c.fn || `${c.lastName} ${c.firstName} ${c.middleName}`.trim();
    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${fn}`,
      `N:${c.lastName};${c.firstName};${c.middleName};;`,
      ...c.phones.filter(Boolean).map((p) => `TEL;CELL:${p}`),
      ...c.emails.filter(Boolean).map((e) => `EMAIL:${e}`),
      c.org      ? `ORG:${c.org}`         : "",
      c.title    ? `TITLE:${c.title}`     : "",
      c.note     ? `NOTE:${c.note}`       : "",
      c.birthday ? `BDAY:${c.birthday}`   : "",
      c.address  ? `ADR:;;${c.address};;;;` : "",
      c.url      ? `URL:${c.url}`         : "",
    ].filter(Boolean);

    if (c.photo && c.photo.startsWith("data:")) {
      const b64 = c.photo.split(",")[1] || "";
      lines.push(`PHOTO;ENCODING=BASE64;TYPE=${c.photoType}:${b64}`);
    } else if (c.photo) {
      lines.push(`PHOTO;VALUE=URI:${c.photo}`);
    }

    lines.push("END:VCARD");
    return lines.join("\r\n");
  }).join("\r\n");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VcfEditor() {
  const [contacts, setContacts]           = useState<VcfContact[]>([]);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [editedContact, setEditedContact] = useState<VcfContact | null>(null);
  const [isDirty, setIsDirty]             = useState(false);
  const [pendingId, setPendingId]         = useState<string | null>(null);
  const [showDialog, setShowDialog]       = useState(false);
  const [mergeInfo, setMergeInfo]         = useState<{ count: number } | null>(null);
  const [search, setSearch]               = useState("");
  const [fileName, setFileName]           = useState("contacts.vcf");
  const [checkedIds, setCheckedIds]       = useState<Set<string>>(new Set());
  const [mergePickDialog, setMergePickDialog] = useState(false);
  const [mergeBaseId, setMergeBaseId]     = useState<string | null>(null);

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const photoInputRef   = useRef<HTMLInputElement>(null);

  const selected = contacts.find((c) => c.id === selectedId);

  // ── filtered list ──
  const filtered = contacts.filter((c) => {
    const q = search.trim();
    if (!q) return true;
    const qLower = q.toLowerCase();
    const qDigits = q.replace(/\D/g, "");

    const matchName =
      c.fn.toLowerCase().includes(qLower) ||
      c.lastName.toLowerCase().includes(qLower) ||
      c.firstName.toLowerCase().includes(qLower) ||
      c.middleName.toLowerCase().includes(qLower);

    const matchPhone =
      qDigits.length > 0 &&
      c.phones.some((p) => p.replace(/\D/g, "").includes(qDigits));

    return matchName || matchPhone;
  });

  // ── file load ──
  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseVcf(text);
      parsed.sort((a, b) => a.fn.localeCompare(b.fn, "ru", { sensitivity: "base" }));
      setContacts(parsed);
      setSelectedId(null);
      setEditedContact(null);
      setIsDirty(false);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const handleDownload = () => {
    const content = contactsToVcf(contacts);
    const blob = new Blob([content], { type: "text/vcard;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  };

  // ── select ──
  const trySelectContact = useCallback((id: string) => {
    if (isDirty && selectedId !== id) {
      setPendingId(id); setShowDialog(true);
    } else {
      const c = contacts.find((x) => x.id === id);
      setSelectedId(id);
      setEditedContact(c ? { ...c } : null);
      setIsDirty(false);
    }
  }, [isDirty, selectedId, contacts]);

  // ── save / cancel ──
  const handleSave = () => {
    if (!editedContact) return;
    setContacts((prev) => prev.map((c) => c.id === editedContact.id ? { ...editedContact } : c));
    setIsDirty(false);
  };

  const handleCancel = () => {
    if (selected) { setEditedContact({ ...selected }); setIsDirty(false); }
  };

  const handleDialogSave = () => {
    handleSave(); setShowDialog(false);
    if (pendingId) {
      const c = contacts.find((x) => x.id === pendingId);
      setSelectedId(pendingId); setEditedContact(c ? { ...c } : null);
      setIsDirty(false); setPendingId(null);
    }
  };

  const handleDialogDiscard = () => {
    setShowDialog(false);
    if (pendingId) {
      const c = contacts.find((x) => x.id === pendingId);
      setSelectedId(pendingId); setEditedContact(c ? { ...c } : null);
      setIsDirty(false); setPendingId(null);
    }
  };

  // ── field change ──
  const handleFieldChange = (key: string, value: string | string[]) => {
    setEditedContact((prev) => prev ? { ...prev, [key]: value } : prev);
    setIsDirty(true);
  };

  // ── delete ──
  const handleDelete = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) { setSelectedId(null); setEditedContact(null); setIsDirty(false); }
  };

  // ── remove empty (no phones) ──
  const handleRemoveEmpty = () => {
    setContacts((prev) => {
      const kept = prev.filter((c) => c.phones.some((p) => p.trim()));
      if (selectedId) {
        const still = kept.find((c) => c.id === selectedId);
        if (!still) { setSelectedId(null); setEditedContact(null); setIsDirty(false); }
      }
      return kept;
    });
  };

  // ── merge duplicates by FIO ──
  const handleMergeDuplicates = () => {
    const groups = new Map<string, VcfContact[]>();
    contacts.forEach((c) => {
      const key = `${c.lastName}|${c.firstName}|${c.middleName}`.toLowerCase().trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    });

    let mergedCount = 0;
    const result: VcfContact[] = [];

    groups.forEach((group) => {
      if (group.length === 1) { result.push(group[0]); return; }
      mergedCount += group.length - 1;
      const base = { ...group[0] };
      group.slice(1).forEach((c) => {
        const allPhones = [...base.phones, ...c.phones].filter(Boolean);
        base.phones = [...new Set(allPhones)];
        const allEmails = [...base.emails, ...c.emails].filter(Boolean);
        base.emails = [...new Set(allEmails)];
        if (!base.org && c.org) base.org = c.org;
        if (!base.note && c.note) base.note = c.note;
        if (!base.photo && c.photo) base.photo = c.photo;
      });
      result.push(base);
    });

    result.sort((a, b) => a.fn.localeCompare(b.fn, "ru", { sensitivity: "base" }));
    setContacts(result);
    setSelectedId(null); setEditedContact(null); setIsDirty(false);
    setMergeInfo({ count: mergedCount });
  };

  // ── merge selected ──
  const handleMergeSelected = () => {
    if (checkedIds.size < 2) return;
    setMergeBaseId([...checkedIds][0]);
    setMergePickDialog(true);
  };

  const handleMergeConfirm = () => {
    if (!mergeBaseId) return;
    const ids = [...checkedIds];
    const base = { ...contacts.find((c) => c.id === mergeBaseId)! };
    const others = contacts.filter((c) => ids.includes(c.id) && c.id !== mergeBaseId);

    others.forEach((c) => {
      const allPhones = [...base.phones, ...c.phones].filter(Boolean);
      base.phones = [...new Set(allPhones)];
      const allEmails = [...base.emails, ...c.emails].filter(Boolean);
      base.emails = [...new Set(allEmails)];
      if (!base.org && c.org) base.org = c.org;
      if (!base.title && c.title) base.title = c.title;
      if (!base.note && c.note) base.note = c.note;
      if (!base.photo && c.photo) { base.photo = c.photo; base.photoType = c.photoType; }
      if (!base.birthday && c.birthday) base.birthday = c.birthday;
      if (!base.address && c.address) base.address = c.address;
      if (!base.url && c.url) base.url = c.url;
    });

    const result = contacts
      .filter((c) => !ids.includes(c.id) || c.id === mergeBaseId)
      .map((c) => c.id === mergeBaseId ? base : c);

    result.sort((a, b) => a.fn.localeCompare(b.fn, "ru", { sensitivity: "base" }));
    setContacts(result);
    setCheckedIds(new Set());
    setMergePickDialog(false);
    setMergeBaseId(null);
    if (selectedId && ids.includes(selectedId) && selectedId !== mergeBaseId) {
      setSelectedId(null); setEditedContact(null); setIsDirty(false);
    }
  };

  // ── photo upload ──
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editedContact) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const typeMatch = dataUrl.match(/data:image\/([^;]+)/);
      const photoType = typeMatch ? typeMatch[1].toUpperCase() : "JPEG";
      setEditedContact((prev) => prev ? { ...prev, photo: dataUrl, photoType } : prev);
      setIsDirty(true);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <motion.header
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.4 }}
        className="border-b border-border bg-card px-6 py-3 flex items-center justify-between shadow-sm flex-shrink-0"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Icon name="Contact" size={16} className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground leading-tight">Редактор VCF файлов</h1>
            {contacts.length > 0 && (
              <p className="text-xs text-muted-foreground">{fileName} · {contacts.length} контактов</p>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {contacts.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleRemoveEmpty} className="gap-1.5 text-xs">
                <Icon name="UserMinus" size={14} />
                Удалить пустые
              </Button>
              <Button variant="outline" size="sm" onClick={handleMergeDuplicates} className="gap-1.5 text-xs">
                <Icon name="Merge" size={14} />
                Объединить дубли
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
            <Icon name="Upload" size={15} />
            Загрузить
          </Button>
          <Button size="sm" onClick={handleDownload} disabled={contacts.length === 0} className="gap-1.5">
            <Icon name="Download" size={15} />
            Скачать
          </Button>
          <input ref={fileInputRef} type="file" accept=".vcf,.vcard" className="hidden" onChange={handleFileLoad} />
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
        </div>
      </motion.header>

      {/* ── Main ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {contacts.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}
            className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-4"
          >
            <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center">
              <Icon name="ContactRound" size={40} className="text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">Загрузите VCF файл</h2>
              <p className="text-muted-foreground max-w-sm">Нажмите кнопку ниже, чтобы открыть книгу контактов</p>
            </div>
            <Button variant="outline" size="lg" onClick={() => fileInputRef.current?.click()} className="gap-2">
              <Icon name="Upload" size={18} />Выбрать файл
            </Button>
          </motion.div>
        ) : (
          <>
            {/* ── Left: contact list ── */}
            <motion.aside
              initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.4, delay: 0.1 }}
              className="w-72 border-r border-border bg-card flex flex-col min-h-0 flex-shrink-0"
            >
              {/* Search */}
              <div className="px-3 py-2 border-b border-border space-y-2 flex-shrink-0">
                <div className="relative">
                  <Icon name="Search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Поиск по ФИО или номеру…"
                    className="pl-8 h-8 text-sm bg-background"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <Icon name="X" size={13} />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{filtered.length} из {contacts.length}</p>
                  {checkedIds.size > 0 && (
                    <button onClick={() => setCheckedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground">
                      Снять выделение
                    </button>
                  )}
                </div>
                {checkedIds.size >= 2 && (
                  <Button size="sm" className="w-full gap-1.5" onClick={handleMergeSelected}>
                    <Icon name="Merge" size={14} />
                    Объединить выбранные ({checkedIds.size})
                  </Button>
                )}
              </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="p-2">
                  <AnimatePresence>
                    {filtered.map((contact, i) => (
                      <ContextMenu key={contact.id}>
                        <ContextMenuTrigger asChild>
                          <motion.div
                            initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}
                            className={`w-full px-2 py-1.5 rounded-lg mb-0.5 flex items-center gap-2 transition-all ${
                              selectedId === contact.id ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
                            }`}
                          >
                            {/* Checkbox */}
                            <input
                              type="checkbox"
                              checked={checkedIds.has(contact.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                setCheckedIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(contact.id);
                                  else next.delete(contact.id);
                                  return next;
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-shrink-0 w-3.5 h-3.5 accent-primary cursor-pointer"
                            />
                            {/* Clickable contact row */}
                            <button
                              onClick={() => trySelectContact(contact.id)}
                              className="flex items-center gap-2 min-w-0 flex-1 text-left"
                            >
                              <div className={`w-7 h-7 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center text-xs font-semibold ${
                                selectedId === contact.id ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                              }`}>
                                {contact.photo
                                  ? <img src={contact.photo} alt="" className="w-full h-full object-cover" />
                                  : contact.fn.charAt(0).toUpperCase() || "?"
                                }
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{contact.fn}</p>
                                {contact.phones[0] && (
                                  <p className={`text-xs truncate ${selectedId === contact.id ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                                    {contact.phones[0]}{contact.phones.filter(Boolean).length > 1 ? ` +${contact.phones.filter(Boolean).length - 1}` : ""}
                                  </p>
                                )}
                              </div>
                            </button>
                          </motion.div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem className="text-destructive focus:text-destructive gap-2" onClick={() => handleDelete(contact.id)}>
                            <Icon name="Trash2" size={14} />Удалить контакт
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </AnimatePresence>
                  {filtered.length === 0 && (
                    <p className="text-center text-muted-foreground text-sm py-8">Ничего не найдено</p>
                  )}
                </div>
              </ScrollArea>
            </motion.aside>

            {/* ── Right: editor ── */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <AnimatePresence mode="wait">
                {editedContact ? (
                  <motion.div
                    key={editedContact.id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                    className="flex-1 flex flex-col overflow-hidden min-h-0"
                  >
                    {/* Editor header */}
                    <div className="px-6 py-3 border-b border-border flex items-center gap-3 flex-shrink-0">
                      <div
                        className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold overflow-hidden cursor-pointer flex-shrink-0"
                        onClick={() => photoInputRef.current?.click()}
                        title="Нажмите для смены фото"
                      >
                        {editedContact.photo
                          ? <img src={editedContact.photo} alt="" className="w-full h-full object-cover" />
                          : <span>{editedContact.fn.charAt(0).toUpperCase() || "?"}</span>
                        }
                      </div>
                      <div className="min-w-0">
                        <h2 className="font-semibold text-foreground truncate">{editedContact.fn || "Без имени"}</h2>
                        <p className="text-xs text-muted-foreground">Нажмите на аватар для смены фото</p>
                      </div>
                      {isDirty && (
                        <Badge variant="outline" className="ml-auto text-amber-600 border-amber-300 bg-amber-50 flex-shrink-0">
                          Есть изменения
                        </Badge>
                      )}
                    </div>

                    {/* Fields */}
                    <ScrollArea className="flex-1 min-h-0">
                      <div className="p-6 space-y-5">

                        {/* ФИО */}
                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Icon name="UserCheck" fallback="Circle" size={13} />ФИО
                          </Label>
                          <div className="grid grid-cols-3 gap-2">
                            <Input value={editedContact.lastName}   onChange={(e) => handleFieldChange("lastName", e.target.value)}   placeholder="Фамилия"  className="bg-background" />
                            <Input value={editedContact.firstName}  onChange={(e) => handleFieldChange("firstName", e.target.value)}  placeholder="Имя"      className="bg-background" />
                            <Input value={editedContact.middleName} onChange={(e) => handleFieldChange("middleName", e.target.value)} placeholder="Отчество" className="bg-background" />
                          </div>
                        </div>

                        {/* Отображаемое имя */}
                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Icon name="User" fallback="Circle" size={13} />Отображаемое имя
                          </Label>
                          <Input value={editedContact.fn} onChange={(e) => handleFieldChange("fn", e.target.value)} placeholder="Отображаемое имя" className="bg-background" />
                          {/* Варианты из ФИО */}
                          {(editedContact.lastName || editedContact.firstName || editedContact.middleName) && (() => {
                            const { lastName: l, firstName: f, middleName: m } = editedContact;
                            const variants = [
                              [l, f, m].filter(Boolean).join(" "),
                              [f, m, l].filter(Boolean).join(" "),
                              [f, l].filter(Boolean).join(" "),
                              [l, f].filter(Boolean).join(" "),
                            ].filter((v, i, arr) => v && arr.indexOf(v) === i);
                            return (
                              <div className="flex flex-wrap gap-1.5 pt-0.5">
                                {variants.map((v) => (
                                  <button
                                    key={v}
                                    type="button"
                                    onClick={() => handleFieldChange("fn", v)}
                                    className={`text-xs px-2 py-0.5 rounded-full border transition-all ${
                                      editedContact.fn === v
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "bg-muted text-muted-foreground border-border hover:border-primary hover:text-foreground"
                                    }`}
                                  >
                                    {v}
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>

                        {/* Телефоны */}
                        <div className="space-y-2">
                          <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Icon name="Phone" fallback="Circle" size={13} />Телефоны
                          </Label>
                          {editedContact.phones.map((phone, idx) => (
                            <div key={idx} className="flex gap-2">
                              <Input
                                value={phone}
                                onChange={(e) => {
                                  const updated = [...editedContact.phones];
                                  updated[idx] = e.target.value;
                                  handleFieldChange("phones", updated);
                                }}
                                placeholder={`Телефон ${idx + 1}`}
                                className="bg-background"
                              />
                              {editedContact.phones.length > 1 && (
                                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive flex-shrink-0"
                                  onClick={() => handleFieldChange("phones", editedContact.phones.filter((_, i) => i !== idx))}>
                                  <Icon name="X" size={15} />
                                </Button>
                              )}
                            </div>
                          ))}
                          {editedContact.phones.length < 10 && (
                            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
                              onClick={() => handleFieldChange("phones", [...editedContact.phones, ""])}>
                              <Icon name="Plus" size={13} />Добавить телефон
                            </Button>
                          )}
                        </div>

                        {/* Email */}
                        <div className="space-y-2">
                          <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Icon name="Mail" fallback="Circle" size={13} />Email
                          </Label>
                          {editedContact.emails.length === 0
                            ? <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
                                onClick={() => handleFieldChange("emails", [""])}>
                                <Icon name="Plus" size={13} />Добавить email
                              </Button>
                            : editedContact.emails.map((email, idx) => (
                              <div key={idx} className="flex gap-2">
                                <Input
                                  value={email}
                                  onChange={(e) => {
                                    const updated = [...editedContact.emails];
                                    updated[idx] = e.target.value;
                                    handleFieldChange("emails", updated);
                                  }}
                                  placeholder="email@example.com"
                                  className="bg-background"
                                />
                                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive flex-shrink-0"
                                  onClick={() => handleFieldChange("emails", editedContact.emails.filter((_, i) => i !== idx))}>
                                  <Icon name="X" size={15} />
                                </Button>
                              </div>
                            ))
                          }
                          {editedContact.emails.length > 0 && editedContact.emails.length < 5 && (
                            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
                              onClick={() => handleFieldChange("emails", [...editedContact.emails, ""])}>
                              <Icon name="Plus" size={13} />Добавить email
                            </Button>
                          )}
                        </div>

                        {/* 2-column fields */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {[
                            { key: "org",      label: "Организация", icon: "Building2"  },
                            { key: "title",    label: "Должность",   icon: "Briefcase"  },
                            { key: "birthday", label: "Дата рождения (ГГГГ-ММ-ДД)", icon: "Cake" },
                            { key: "url",      label: "Сайт / URL",  icon: "Globe"      },
                            { key: "address",  label: "Адрес",       icon: "MapPin"     },
                          ].map(({ key, label, icon }) => (
                            <div key={key} className="space-y-1.5">
                              <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Icon name={icon} fallback="Circle" size={13} />{label}
                              </Label>
                              <Input
                                value={(editedContact[key as keyof VcfContact] as string) || ""}
                                onChange={(e) => handleFieldChange(key, e.target.value)}
                                placeholder={label}
                                className="bg-background"
                              />
                            </div>
                          ))}
                        </div>

                        {/* Note */}
                        <div className="space-y-1.5">
                          <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Icon name="FileText" fallback="Circle" size={13} />Заметка
                          </Label>
                          <Input value={editedContact.note} onChange={(e) => handleFieldChange("note", e.target.value)} placeholder="Заметка" className="bg-background" />
                        </div>

                        {/* Extra fields (read-only display) */}
                        {editedContact.extraFields.length > 0 && (
                          <div className="space-y-2">
                            <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Icon name="Tag" fallback="Circle" size={13} />Дополнительные поля
                            </Label>
                            <div className="rounded-lg border border-border divide-y divide-border">
                              {editedContact.extraFields.map((f, idx) => (
                                <div key={idx} className="flex items-start gap-3 px-3 py-2 text-sm">
                                  <span className="text-muted-foreground font-mono text-xs w-32 flex-shrink-0 pt-0.5">{f.key}</span>
                                  <span className="text-foreground break-all">{f.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Photo controls */}
                        <div className="space-y-2">
                          <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Icon name="Image" fallback="Circle" size={13} />Фото
                          </Label>
                          {editedContact.photo ? (
                            <div className="flex items-center gap-3">
                              <img src={editedContact.photo} alt="Фото контакта" className="w-16 h-16 rounded-lg object-cover border border-border" />
                              <div className="flex flex-col gap-2">
                                <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} className="gap-1.5">
                                  <Icon name="ImagePlus" size={14} />Сменить фото
                                </Button>
                                <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive"
                                  onClick={() => handleFieldChange("photo", "")}>
                                  <Icon name="Trash2" size={14} />Удалить фото
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} className="gap-1.5">
                              <Icon name="ImagePlus" size={14} />Добавить фото
                            </Button>
                          )}
                        </div>

                      </div>
                    </ScrollArea>

                    {/* Bottom actions */}
                    <div className="px-6 py-3 border-t border-border bg-card flex items-center gap-3 flex-shrink-0">
                      <Button onClick={handleSave} disabled={!isDirty} className="gap-2">
                        <Icon name="Save" size={15} />Сохранить
                      </Button>
                      <Button variant="outline" onClick={handleCancel} disabled={!isDirty} className="gap-2">
                        <Icon name="RotateCcw" size={15} />Отменить
                      </Button>
                      <Button variant="destructive" onClick={() => editedContact && handleDelete(editedContact.id)} className="gap-2 ml-auto">
                        <Icon name="Trash2" size={15} />Удалить контакт
                      </Button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="flex-1 flex items-center justify-center flex-col gap-3 text-center px-4">
                    <Icon name="MousePointerClick" size={36} className="text-muted-foreground" />
                    <p className="text-muted-foreground text-sm">Выберите контакт из списка слева для редактирования</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>

      {/* ── Save dialog ── */}
      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сохранить изменения?</AlertDialogTitle>
            <AlertDialogDescription>Вы переходите к другому контакту. Сохранить изменения в текущем?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setShowDialog(false); setPendingId(null); }}>Отмена</AlertDialogCancel>
            <Button variant="outline" onClick={handleDialogDiscard}>Не сохранять</Button>
            <AlertDialogAction onClick={handleDialogSave}>Сохранить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Merge result dialog ── */}
      <AlertDialog open={!!mergeInfo} onOpenChange={() => setMergeInfo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Объединение завершено</AlertDialogTitle>
            <AlertDialogDescription>
              Удалено дублей: <strong>{mergeInfo?.count}</strong>. Телефоны и email объединены в один контакт.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setMergeInfo(null)}>Отлично</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Merge pick base dialog ── */}
      <AlertDialog open={mergePickDialog} onOpenChange={(o) => { if (!o) { setMergePickDialog(false); setMergeBaseId(null); } }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Какой контакт оставить?</AlertDialogTitle>
            <AlertDialogDescription>
              Данные из остальных {checkedIds.size - 1} контактов (телефоны, email и др.) будут добавлены в выбранный. Остальные удалятся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-1 max-h-60 overflow-y-auto">
            {[...checkedIds].map((id) => {
              const c = contacts.find((x) => x.id === id);
              if (!c) return null;
              return (
                <button
                  key={id}
                  onClick={() => setMergeBaseId(id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-left ${
                    mergeBaseId === id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-muted overflow-hidden flex items-center justify-center text-sm font-semibold flex-shrink-0">
                    {c.photo ? <img src={c.photo} alt="" className="w-full h-full object-cover" /> : c.fn.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.fn}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.phones.filter(Boolean).join(", ")}</p>
                  </div>
                  {mergeBaseId === id && <Icon name="Check" size={16} className="text-primary ml-auto flex-shrink-0" />}
                </button>
              );
            })}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setMergePickDialog(false); setMergeBaseId(null); }}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleMergeConfirm} disabled={!mergeBaseId}>
              Объединить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}