import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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

interface VcfContact {
  id: string;
  fn: string;
  lastName: string;
  firstName: string;
  middleName: string;
  phones: string[];
  email: string;
  org: string;
  title: string;
  note: string;
  raw: string[];
}

// Decode Quoted-Printable encoded string (UTF-8 bytes)
function decodeQP(str: string): string {
  try {
    // Remove QP soft line breaks FIRST (= at end of line, before \r\n or \n)
    const joined = str.replace(/=\r?\n/g, "");
    // Then decode =XX sequences as raw bytes, then interpret as UTF-8
    const bytes = joined.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    // Use TextDecoder-compatible approach via escape/decodeURIComponent
    return decodeURIComponent(escape(bytes));
  } catch {
    return str;
  }
}

// Unfold vCard lines:
// 1. VCF folding: continuation lines start with SPACE or TAB
// 2. QP soft line breaks: line ends with = (the = is part of value, not a separator)
function unfoldLines(raw: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    // VCF standard folding (RFC 6350): next line starts with space/tab
    while (i + 1 < raw.length && /^[ \t]/.test(raw[i + 1])) {
      i++;
      line += raw[i].replace(/^[ \t]/, "");
    }
    result.push(line);
  }
  return result;
}

// Pre-process: join QP soft-broken lines BEFORE splitting into logical lines
// QP soft break: line ends with = (no trailing space), next line is continuation
function joinQPSoftBreaks(content: string): string {
  // Replace =\r\n or =\n (QP soft line break) with nothing — joins the lines
  return content.replace(/=\r?\n/g, "");
}

function getFieldValue(lines: string[], keyPrefix: string): string {
  const upper = keyPrefix.toUpperCase();
  const line = lines.find((l) => l.toUpperCase().startsWith(upper));
  if (!line) return "";
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return "";
  const params = line.slice(0, colonIdx).toUpperCase();
  const value = line.slice(colonIdx + 1);
  if (params.includes("QUOTED-PRINTABLE")) return decodeQP(value);
  return value.trim();
}

function getAllFieldValues(lines: string[], keyPrefix: string): string[] {
  const upper = keyPrefix.toUpperCase();
  return lines
    .filter((l) => l.toUpperCase().startsWith(upper))
    .map((line) => {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) return "";
      const params = line.slice(0, colonIdx).toUpperCase();
      const value = line.slice(colonIdx + 1);
      return params.includes("QUOTED-PRINTABLE") ? decodeQP(value) : value.trim();
    })
    .filter(Boolean);
}

function parseVcf(content: string): VcfContact[] {
  // Step 1: join QP soft-broken lines at the raw content level
  const preprocessed = joinQPSoftBreaks(content);
  const blocks = preprocessed.split(/END:VCARD/i).filter((b) => b.trim());

  return blocks.map((block, i) => {
    const rawLines = block.split(/\r?\n/).filter((l) => l.trim());
    // Step 2: unfold VCF standard folded lines (space/tab continuation)
    const lines = unfoldLines(rawLines);

    const fn = getFieldValue(lines, "FN");
    const nRaw = getFieldValue(lines, "N");
    // N field: LASTNAME;FIRSTNAME;MIDDLENAME;PREFIX;SUFFIX
    const parts = nRaw.split(";");
    const lastName = parts[0]?.trim() || "";
    const firstName = parts[1]?.trim() || "";
    const middleName = parts[2]?.trim() || "";

    const phones = getAllFieldValues(lines, "TEL");
    const email = getFieldValue(lines, "EMAIL");
    const org = getFieldValue(lines, "ORG");
    const title = getFieldValue(lines, "TITLE");
    const note = getFieldValue(lines, "NOTE");

    const displayName =
      fn ||
      `${firstName} ${lastName}`.trim() ||
      org ||
      phones[0] ||
      `Контакт ${i + 1}`;

    return {
      id: `contact-${i}`,
      fn: displayName,
      lastName,
      firstName,
      middleName,
      phones: phones.length > 0 ? phones : [""],
      email,
      org,
      title,
      note,
      raw: rawLines,
    };
  });
}

function contactsToVcf(contacts: VcfContact[]): string {
  return contacts
    .map((c) => {
      const fn = c.fn || `${c.firstName} ${c.lastName}`.trim();
      return [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${fn}`,
        `N:${c.lastName};${c.firstName};${c.middleName};;`,
        ...c.phones.filter(Boolean).map((p) => `TEL;CELL:${p}`),
        c.email ? `EMAIL:${c.email}` : "",
        c.org ? `ORG:${c.org}` : "",
        c.title ? `TITLE:${c.title}` : "",
        c.note ? `NOTE:${c.note}` : "",
        "END:VCARD",
      ]
        .filter(Boolean)
        .join("\r\n");
    })
    .join("\r\n");
}

const singleFields = [
  { key: "fn", label: "Отображаемое имя", icon: "User" },
  { key: "email", label: "Email", icon: "Mail" },
  { key: "org", label: "Организация", icon: "Building2" },
  { key: "title", label: "Должность", icon: "Briefcase" },
  { key: "note", label: "Заметка", icon: "FileText" },
] as const;

export default function VcfEditor() {
  const [contacts, setContacts] = useState<VcfContact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editedContact, setEditedContact] = useState<VcfContact | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const [fileName, setFileName] = useState("contacts.vcf");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = contacts.find((c) => c.id === selectedId);

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
  };

  const handleDownload = () => {
    const content = contactsToVcf(contacts);
    const blob = new Blob([content], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const trySelectContact = useCallback(
    (id: string) => {
      if (isDirty && selectedId !== id) {
        setPendingId(id);
        setShowDialog(true);
      } else {
        const c = contacts.find((x) => x.id === id);
        setSelectedId(id);
        setEditedContact(c ? { ...c } : null);
        setIsDirty(false);
      }
    },
    [isDirty, selectedId, contacts]
  );

  const handleSave = () => {
    if (!editedContact) return;
    setContacts((prev) =>
      prev.map((c) => (c.id === editedContact.id ? { ...editedContact } : c))
    );
    setSelectedId(editedContact.id);
    setIsDirty(false);
  };

  const handleCancel = () => {
    if (selected) {
      setEditedContact({ ...selected });
      setIsDirty(false);
    }
  };

  const handleDialogSave = () => {
    handleSave();
    setShowDialog(false);
    if (pendingId) {
      const c = contacts.find((x) => x.id === pendingId);
      setSelectedId(pendingId);
      setEditedContact(c ? { ...c } : null);
      setIsDirty(false);
      setPendingId(null);
    }
  };

  const handleDialogDiscard = () => {
    setShowDialog(false);
    if (pendingId) {
      const c = contacts.find((x) => x.id === pendingId);
      setSelectedId(pendingId);
      setEditedContact(c ? { ...c } : null);
      setIsDirty(false);
      setPendingId(null);
    }
  };

  const handleFieldChange = (key: string, value: string | string[]) => {
    setEditedContact((prev) => (prev ? { ...prev, [key]: value } : prev));
    setIsDirty(true);
  };

  const handleDelete = (id: string) => {
    const remaining = contacts.filter((c) => c.id !== id);
    setContacts(remaining);
    if (selectedId === id) {
      setSelectedId(null);
      setEditedContact(null);
      setIsDirty(false);
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="border-b border-border bg-card px-6 py-4 flex items-center justify-between shadow-sm"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Icon name="Contact" size={16} className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Редактор VCF файлов</h1>
            {contacts.length > 0 && (
              <p className="text-xs text-muted-foreground">{fileName} · {contacts.length} контактов</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
            <Icon name="Upload" size={16} />
            Загрузить файл
          </Button>
          <Button onClick={handleDownload} disabled={contacts.length === 0} className="gap-2">
            <Icon name="Download" size={16} />
            Скачать файл
          </Button>
          <input ref={fileInputRef} type="file" accept=".vcf,.vcard" className="hidden" onChange={handleFileLoad} />
        </div>
      </motion.header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {contacts.length === 0 ? (
          // Empty state
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-4"
          >
            <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center">
              <Icon name="ContactRound" size={40} className="text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">Загрузите VCF файл</h2>
              <p className="text-muted-foreground max-w-sm">
                Нажмите «Загрузить файл» в верхнем меню, чтобы открыть книгу контактов и начать редактирование
              </p>
            </div>
            <Button variant="outline" size="lg" onClick={() => fileInputRef.current?.click()} className="gap-2">
              <Icon name="Upload" size={18} />
              Выбрать файл
            </Button>
          </motion.div>
        ) : (
          <>
            {/* Left panel — contacts list */}
            <motion.aside
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="w-72 border-r border-border bg-card flex flex-col min-h-0"
            >
              <div className="px-4 py-3 border-b border-border">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Контакты</p>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2">
                  <AnimatePresence>
                    {contacts.map((contact, i) => (
                      <ContextMenu key={contact.id}>
                        <ContextMenuTrigger asChild>
                          <motion.button
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.03 }}
                            onClick={() => trySelectContact(contact.id)}
                            className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 flex items-center gap-3 transition-all ${
                              selectedId === contact.id
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-muted text-foreground"
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${
                              selectedId === contact.id ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                            }`}>
                              {contact.fn.charAt(0).toUpperCase() || "?"}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{contact.fn}</p>
                              {contact.phones[0] && (
                                <p className={`text-xs truncate ${selectedId === contact.id ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                                  {contact.phones[0]}{contact.phones.filter(Boolean).length > 1 ? ` +${contact.phones.filter(Boolean).length - 1}` : ""}
                                </p>
                              )}
                            </div>
                          </motion.button>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                            className="text-destructive focus:text-destructive gap-2"
                            onClick={() => handleDelete(contact.id)}
                          >
                            <Icon name="Trash2" size={14} />
                            Удалить контакт
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </AnimatePresence>
                </div>
              </ScrollArea>
            </motion.aside>

            {/* Right panel — editor */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <AnimatePresence mode="wait">
                {editedContact ? (
                  <motion.div
                    key={editedContact.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex-1 flex flex-col overflow-hidden min-h-0"
                  >
                    <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold">
                        {editedContact.fn.charAt(0).toUpperCase() || "?"}
                      </div>
                      <div>
                        <h2 className="font-semibold text-foreground">{editedContact.fn || "Без имени"}</h2>
                        <p className="text-xs text-muted-foreground">Редактирование реквизитов</p>
                      </div>
                      {isDirty && (
                        <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Есть изменения</span>
                      )}
                    </div>

                    <ScrollArea className="flex-1">
                      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
                        {/* ФИО — три поля в одну строку */}
                        <div className="sm:col-span-2 space-y-1.5">
                          <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Icon name="UserCheck" fallback="Circle" size={13} />
                            ФИО
                          </Label>
                          <div className="grid grid-cols-3 gap-2">
                            <Input
                              value={editedContact.lastName}
                              onChange={(e) => handleFieldChange("lastName", e.target.value)}
                              placeholder="Фамилия"
                              className="bg-background"
                            />
                            <Input
                              value={editedContact.firstName}
                              onChange={(e) => handleFieldChange("firstName", e.target.value)}
                              placeholder="Имя"
                              className="bg-background"
                            />
                            <Input
                              value={editedContact.middleName}
                              onChange={(e) => handleFieldChange("middleName", e.target.value)}
                              placeholder="Отчество"
                              className="bg-background"
                            />
                          </div>
                        </div>

                        {/* Phones block */}
                        <div className="space-y-2 sm:col-span-2">
                          <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Icon name="Phone" fallback="Circle" size={13} />
                            Телефоны
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
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => {
                                    const updated = editedContact.phones.filter((_, i) => i !== idx);
                                    handleFieldChange("phones", updated);
                                  }}
                                >
                                  <Icon name="X" size={15} />
                                </Button>
                              )}
                            </div>
                          ))}
                          {editedContact.phones.length < 5 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 text-muted-foreground"
                              onClick={() => {
                                const updated = [...editedContact.phones, ""];
                                handleFieldChange("phones", updated);
                              }}
                            >
                              <Icon name="Plus" size={13} />
                              Добавить телефон
                            </Button>
                          )}
                        </div>

                        {/* Single-value fields */}
                        {singleFields.map((field) => (
                          <div key={field.key} className="space-y-1.5">
                            <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Icon name={field.icon} fallback="Circle" size={13} />
                              {field.label}
                            </Label>
                            <Input
                              value={(editedContact[field.key as keyof VcfContact] as string) || ""}
                              onChange={(e) => handleFieldChange(field.key, e.target.value)}
                              placeholder={field.label}
                              className="bg-background"
                            />
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    {/* Bottom actions */}
                    <motion.div
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      className="px-6 py-4 border-t border-border bg-card flex items-center gap-3"
                    >
                      <Button onClick={handleSave} disabled={!isDirty} className="gap-2">
                        <Icon name="Save" size={15} />
                        Сохранить изменения
                      </Button>
                      <Button variant="outline" onClick={handleCancel} disabled={!isDirty} className="gap-2">
                        <Icon name="RotateCcw" size={15} />
                        Отменить
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => editedContact && handleDelete(editedContact.id)}
                        className="gap-2 ml-auto"
                      >
                        <Icon name="Trash2" size={15} />
                        Удалить контакт
                      </Button>
                    </motion.div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex-1 flex items-center justify-center flex-col gap-3 text-center px-4"
                  >
                    <Icon name="MousePointerClick" size={36} className="text-muted-foreground" />
                    <p className="text-muted-foreground text-sm">Выберите контакт из списка слева для редактирования</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>

      {/* Save dialog */}
      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сохранить изменения?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы переходите к другому контакту. Сохранить изменения в текущем контакте?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setShowDialog(false); setPendingId(null); }}>Отмена</AlertDialogCancel>
            <Button variant="outline" onClick={handleDialogDiscard}>Не сохранять</Button>
            <AlertDialogAction onClick={handleDialogSave}>Сохранить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}