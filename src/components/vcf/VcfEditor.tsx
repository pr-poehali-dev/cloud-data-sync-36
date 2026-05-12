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
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  org: string;
  title: string;
  note: string;
  raw: string[];
}

function parseVcf(content: string): VcfContact[] {
  const blocks = content.split(/END:VCARD/i).filter((b) => b.trim());
  return blocks.map((block, i) => {
    const lines = block.split(/\r?\n/).filter((l) => l.trim());
    const get = (key: string) => {
      const line = lines.find((l) =>
        l.toUpperCase().startsWith(key.toUpperCase() + ":")
      );
      return line ? line.slice(key.length + 1).trim() : "";
    };
    const fn = get("FN");
    const n = get("N");
    const parts = n.split(";");
    const lastName = parts[0] || "";
    const firstName = parts[1] || "";
    const phone =
      lines
        .find((l) => l.toUpperCase().startsWith("TEL"))
        ?.replace(/^[^:]+:/, "")
        .trim() || "";
    const email =
      lines
        .find((l) => l.toUpperCase().startsWith("EMAIL"))
        ?.replace(/^[^:]+:/, "")
        .trim() || "";
    return {
      id: `contact-${i}`,
      fn: fn || `${firstName} ${lastName}`.trim() || `Контакт ${i + 1}`,
      firstName,
      lastName,
      phone,
      email,
      org: get("ORG"),
      title: get("TITLE"),
      note: get("NOTE"),
      raw: lines,
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
        `N:${c.lastName};${c.firstName};;;`,
        c.phone ? `TEL:${c.phone}` : "",
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

const fields = [
  { key: "fn", label: "Отображаемое имя", icon: "User" },
  { key: "firstName", label: "Имя", icon: "UserCheck" },
  { key: "lastName", label: "Фамилия", icon: "UserCheck" },
  { key: "phone", label: "Телефон", icon: "Phone" },
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
  const [deleteId, setDeleteId] = useState<string | null>(null);
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

  const handleFieldChange = (key: string, value: string) => {
    setEditedContact((prev) => (prev ? { ...prev, [key]: value } : prev));
    setIsDirty(true);
  };

  const handleDeleteConfirm = () => {
    if (!deleteId) return;
    const remaining = contacts.filter((c) => c.id !== deleteId);
    setContacts(remaining);
    if (selectedId === deleteId) {
      setSelectedId(null);
      setEditedContact(null);
      setIsDirty(false);
    }
    setDeleteId(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
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
              className="w-72 border-r border-border bg-card flex flex-col"
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
                              {contact.phone && (
                                <p className={`text-xs truncate ${selectedId === contact.id ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                                  {contact.phone}
                                </p>
                              )}
                            </div>
                          </motion.button>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                            className="text-destructive focus:text-destructive gap-2"
                            onClick={() => setDeleteId(contact.id)}
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
            <div className="flex-1 flex flex-col overflow-hidden">
              <AnimatePresence mode="wait">
                {editedContact ? (
                  <motion.div
                    key={editedContact.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.25 }}
                    className="flex-1 flex flex-col overflow-hidden"
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
                        {fields.map((field) => (
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
                        onClick={() => editedContact && setDeleteId(editedContact.id)}
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

      {/* Delete dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить контакт?</AlertDialogTitle>
            <AlertDialogDescription>
              Контакт «{contacts.find((c) => c.id === deleteId)?.fn}» будет удалён безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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