import { collection, doc, query, where, orderBy, setDoc, deleteDoc, updateDoc, getDocs } from "firebase/firestore";
import { useDocument, useCollection } from "react-firebase-hooks/firestore";
import { ArrowLeft, Trash2, Download, Menu, X, Play, Square, Settings, Volume2, Plus, Edit2, Save, Bookmark, Undo, Redo, Globe, MoreVertical, Share2, ClipboardCopy, CheckCircle2, ChevronDown, ChevronRight, Home, Settings2, BarChart3, Clock, Type } from "lucide-react";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { v4 as uuidv4 } from "uuid";
import { db } from "../firebase";
import { ViewState } from "../App";
import { cn } from "../lib/utils";

interface ReaderProps {
  bookId: string;
  setView: (view: ViewState) => void;
  userId: string;
}

export function Reader({ bookId, setView, userId }: ReaderProps) {
  
  const bookRef = doc(db, 'books', bookId);
  const [bookSnapshot, loadingBook, bookError] = useDocument(bookRef);
  const bookData = bookSnapshot?.exists() ? { id: bookSnapshot.id, ...bookSnapshot.data() } as any : null;
  
  // Normalize \r\n to \n to mathematically match DOM length calculations
  const normalizedContent = bookData?.content ? bookData.content.replace(/\r\n/g, '\n') : "";
  const book = bookData ? { ...bookData, content: normalizedContent } : null;

  const canEdit = book?.userId === userId && userId !== "";

// Removed ai instance from frontend

  const annsRef = collection(db, 'annotations');
  const [annsSnapshot] = useCollection(
    query(annsRef, where('bookId', '==', bookId))
  );
  const annotations = annsSnapshot?.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
  
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: number, end: number, text: string, rect: DOMRect } | null>(null);
  const [showNotePad, setShowNotePad] = useState(false);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [currentNote, setCurrentNote] = useState("");
  const [selectedColor, setSelectedColor] = useState("bg-highlight");
  
  // Interactive note menu
  const [activeNoteMenu, setActiveNoteMenu] = useState<{ id: string, note: string | null, text: string, rect: DOMRect, isLocked?: boolean } | null>(null);
  const hoverTimeoutRef = useRef<any>(null);
  
  // General Notes State
  const [showGeneralNotePad, setShowGeneralNotePad] = useState(false);
  const [currentGeneralNote, setCurrentGeneralNote] = useState("");
  const [editingGeneralNoteId, setEditingGeneralNoteId] = useState<string | null>(null);

  const [showSidebar, setShowSidebar] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    navigation: true,
    tools: true,
    annotations: true,
    history: false
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Draggable Popups State & Refs
  const [notePadPos, setNotePadPos] = useState<{ x: number, y: number } | null>(null);
  const [generalNotePadPos, setGeneralNotePadPos] = useState<{ x: number, y: number } | null>(null);
  const notePadRef = useRef<HTMLDivElement>(null);
  const generalNotePadRef = useRef<HTMLDivElement>(null);
  const activeDragRef = useRef<{ 
    element: HTMLElement, 
    startX: number, 
    startY: number, 
    initialX: number, 
    initialY: number,
    type: 'note' | 'general'
  } | null>(null);

  // Layout State
  const [zoomWidth, setZoomWidth] = useState(100);

  // Audio / TTS State
  const [showAudioPanel, setShowAudioPanel] = useState(false);
  const [voiceName, setVoiceName] = useState("Kore");
  const [ttsLanguage, setTtsLanguage] = useState("Auto (Detectar)");
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Edit Mode State
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  // History State
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoStack = useRef<{ undo: () => Promise<void>, redo: () => Promise<void> }[]>([]);
  const redoStack = useRef<{ undo: () => Promise<void>, redo: () => Promise<void> }[]>([]);

  // Menu State
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [copiedAnnotationId, setCopiedAnnotationId] = useState<string | null>(null);

  const pushToHistory = (item: { undo: () => Promise<void>, redo: () => Promise<void> }) => {
    undoStack.current.push(item);
    if (undoStack.current.length > 40) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const handleUndo = async () => {
    const item = undoStack.current.pop();
    if (!item) return;
    await item.undo();
    redoStack.current.push(item);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  };

  const handleRedo = async () => {
    const item = redoStack.current.pop();
    if (!item) return;
    await item.redo();
    undoStack.current.push(item);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  };

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      // Close options menu when clicking outside
      if (showOptionsMenu) {
         const target = e.target as HTMLElement;
         if (!target.closest("#options-dropdown") && !target.closest("#options-button")) {
           setShowOptionsMenu(false);
         }
      }
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, [showOptionsMenu]);

  useEffect(() => {
    if (book && !isEditing) {
      setEditTitle(book.title);
      setEditContent(book.content);
    }
  }, [book, isEditing]);

  const paragraphs = book?.content.split('\n').filter((p: string) => p.trim()) || [];

  // Utility to get absolute offset in our container safely
  function getAbsoluteOffset(container: Node, node: Node, offset: number): number {
    try {
      const range = document.createRange();
      range.setStart(container, 0);
      range.setEnd(node, offset);
      return range.toString().length;
    } catch (e) {
      return -1;
    }
  }

  function handleMarkEnter(ann: any, e: React.PointerEvent | React.MouseEvent, forceLock = false) {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    
    // If a note is already locked and we are just hovering over another one, ignore it
    if (activeNoteMenu?.isLocked && !forceLock && activeNoteMenu.id !== ann.id) {
      return;
    }

    const rect = e.currentTarget.getClientRects()[0] || e.currentTarget.getBoundingClientRect();
    
    // If it's a click (forceLock), it stays locked. If hover, it stays locked ONLY if it was already locked for THIS note.
    const shouldLock = forceLock || (activeNoteMenu?.id === ann.id && activeNoteMenu?.isLocked);
    
    setActiveNoteMenu({ 
      id: ann.id, 
      note: ann.note || null, 
      text: ann.selectedText || "", 
      rect, 
      isLocked: shouldLock 
    });
  }

  function handleMarkLeave() {
    if (activeNoteMenu?.isLocked) return;
    hoverTimeoutRef.current = setTimeout(() => {
      setActiveNoteMenu(null);
    }, 300);
  }

  useEffect(() => {
    function handleGlobalPointerDown() {
      setActiveNoteMenu(null);
    }
    document.addEventListener("pointerdown", handleGlobalPointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleGlobalPointerDown);
      stopAudio(); // cleanup audio on unmount
    };
  }, []);

  function stopAudio() {
    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    setIsPlaying(false);
  }

  async function generateAndPlayTTS(textOverride?: string) {
    if (!book?.content && !textOverride) return;
    if (isPlaying && !textOverride) {
      stopAudio();
      return;
    }

    stopAudio();
    setIsGeneratingAudio(true);
    
    try {
      const rawText = textOverride || book?.content || "";
      if (!rawText.trim()) {
        setIsGeneratingAudio(false);
        return;
      }

      const textToRead = ttsLanguage !== "Auto (Detectar)" 
          ? `[Por favor, narre o seguinte texto usando pronúncia e sotaque em ${ttsLanguage}:]\n\n${rawText}` 
          : rawText;

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textToRead, voiceName }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to fetch audio");

      const base64Audio = data.audio;
      if (base64Audio) {
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const int16Array = new Int16Array(bytes.buffer);

        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const audioCtx = audioContextRef.current;
        const audioBuffer = audioCtx.createBuffer(1, int16Array.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16Array.length; i++) {
          channelData[i] = int16Array[i] / 32768; // Convert [-32768, 32767] to [-1, 1]
        }

        stopAudio();
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.onended = () => setIsPlaying(false);
        source.start();
        audioSourceRef.current = source;
        setIsPlaying(true);
      }
    } catch (err) {
      console.error("Audio generation failed:", err);
      alert("Falha ao gerar o áudio. Tente um trecho menor (limites da rede).");
    } finally {
      setIsGeneratingAudio(false);
    }
  }

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      const drag = activeDragRef.current;
      if (!drag) return;
      
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      
      const nextX = drag.initialX + dx;
      const nextY = drag.initialY + dy;
      
      const halfWidth = 208; 
      const safeX = Math.max(halfWidth, Math.min(window.innerWidth - halfWidth, nextX));
      const safeY = Math.max(100, Math.min(window.innerHeight - 250, nextY));
      
      drag.element.style.left = `${safeX}px`;
      drag.element.style.top = `${safeY}px`;
    }

    function handlePointerUp() {
      const drag = activeDragRef.current;
      if (drag) {
        const finalX = parseFloat(drag.element.style.left);
        const finalY = parseFloat(drag.element.style.top);
        if (drag.type === 'note') setNotePadPos({ x: finalX, y: finalY });
        else setGeneralNotePadPos({ x: finalX, y: finalY });
        
        activeDragRef.current = null;
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    if (showNotePad && selectionRange && !notePadPos) {
      // Clamping opening position to keep it mostly centered and visible
      // Using 220px margin for 384px width
      const x = Math.max(220, Math.min(window.innerWidth - 220, selectionRange.rect.left + (selectionRange.rect.width / 2)));
      const y = Math.max(120, Math.min(window.innerHeight - 300, selectionRange.rect.bottom + 20));
      setNotePadPos({ x, y });
    }
    if (!showNotePad) {
      setNotePadPos(null);
      setEditingAnnotationId(null);
    }
  }, [showNotePad, selectionRange]);

  useEffect(() => {
    if (showGeneralNotePad && !generalNotePadPos) {
      // Default position for general note: bottom right but safe
      setGeneralNotePadPos({ x: window.innerWidth - 210, y: window.innerHeight - 220 });
    }
    if (!showGeneralNotePad) setGeneralNotePadPos(null);
  }, [showGeneralNotePad]);

  useEffect(() => {
    let timeout: any;
    function handleSelectionChange() {
      if (showNotePad || !book) return;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !contentRef.current) {
          setSelectionRange(null);
          return;
        }

        if (!contentRef.current.contains(selection.anchorNode)) {
          setSelectionRange(null);
          return;
        }

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        if (rect.width === 0 && rect.height === 0) return;

        const start = getAbsoluteOffset(contentRef.current, range.startContainer, range.startOffset);
        const end = getAbsoluteOffset(contentRef.current, range.endContainer, range.endOffset);
        
        if (start === -1 || end === -1) {
          setSelectionRange(null);
          return;
        }

        const realStart = Math.min(start, end);
        const realEnd = Math.max(start, end);
        
        const text = book.content.substring(realStart, realEnd);

        if (text.trim().length > 0) {
          setSelectionRange(prev => {
             if (prev && prev.start === realStart && prev.end === realEnd) return prev;
             return { start: realStart, end: realEnd, text, rect };
          });
        } else {
          setSelectionRange(null);
        }
      }, 50);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      clearTimeout(timeout);
    }
  }, [showNotePad, book]);

  async function handleAddAnnotation(withNote: boolean) {
    if (!selectionRange || !book) return;
    
    if (editingAnnotationId) {
      const ann = annotations?.find(a => a.id === editingAnnotationId);
      if (ann) {
        const prevData = { note: ann.note, color: ann.color };
        const newData = { note: currentNote.trim(), color: selectedColor };
        const targetId = editingAnnotationId;

        await updateDoc(doc(db, 'annotations', targetId), {
          ...newData,
          updatedAt: Date.now()
        });

        pushToHistory({
          undo: async () => { await updateDoc(doc(db, 'annotations', targetId), { ...prevData, updatedAt: Date.now() }); },
          redo: async () => { await updateDoc(doc(db, 'annotations', targetId), { ...newData, updatedAt: Date.now() }); }
        });
      }
    } else {
      const id = uuidv4();
      const newData = {
        userId,
        bookId,
        bookOwnerId: book.userId,
        startIndex: selectionRange.start,
        endIndex: selectionRange.end,
        selectedText: selectionRange.text.substring(0, 50000), // Safety limit
        note: currentNote.trim(),
        color: selectedColor,
        isBookPublic: book.isPublic || false,
        createdAt: Date.now()
      };
      await setDoc(doc(db, 'annotations', id), newData);

      pushToHistory({
        undo: async () => { await deleteDoc(doc(db, 'annotations', id)); },
        redo: async () => { await setDoc(doc(db, 'annotations', id), newData); }
      });
    }
    
    setSelectionRange(null);
    setShowNotePad(false);
    setCurrentNote("");
    setEditingAnnotationId(null);
    window.getSelection()?.removeAllRanges();
  }

  function handleOpenEditNote(ann: any) {
    setEditingAnnotationId(ann.id);
    setCurrentNote(ann.note || "");
    setSelectedColor(ann.color || "bg-highlight");
    
    // Position based on the current rect
    // Note: 'ann' here is usually the activeNoteMenu object which has 'text' instead of 'selectedText'
    setSelectionRange({
      start: ann.startIndex !== undefined ? ann.startIndex : -1,
      end: ann.endIndex !== undefined ? ann.endIndex : -1,
      text: ann.text || ann.selectedText || "",
      rect: ann.rect
    });
    
    setShowNotePad(true);
    setActiveNoteMenu(null);
  }

  async function handleAddGeneralNote() {
    if (!book || !currentGeneralNote.trim()) return;

    if (editingGeneralNoteId) {
      const ann = annotations?.find(a => a.id === editingGeneralNoteId);
      if (ann) {
        const prevNote = ann.note;
        const newNote = currentGeneralNote.trim();
        const targetId = editingGeneralNoteId;

        await updateDoc(doc(db, 'annotations', targetId), {
          note: newNote,
          updatedAt: Date.now()
        });

        pushToHistory({
          undo: async () => { await updateDoc(doc(db, 'annotations', targetId), { note: prevNote, updatedAt: Date.now() }); },
          redo: async () => { await updateDoc(doc(db, 'annotations', targetId), { note: newNote, updatedAt: Date.now() }); }
        });
      }
    } else {
      const id = uuidv4();
      const newData = {
        userId,
        bookId,
        bookOwnerId: book.userId,
        startIndex: -1,
        endIndex: -1,
        selectedText: "",
        note: currentGeneralNote.trim(),
        color: "bg-[#e0ddd5]",
        isBookPublic: book.isPublic || false,
        createdAt: Date.now()
      };
      await setDoc(doc(db, 'annotations', id), newData);

      pushToHistory({
        undo: async () => { await deleteDoc(doc(db, 'annotations', id)); },
        redo: async () => { await setDoc(doc(db, 'annotations', id), newData); }
      });
    }

    setShowGeneralNotePad(false);
    setCurrentGeneralNote("");
    setEditingGeneralNoteId(null);
  }

  function handleOpenEditGeneralNote(ann: any) {
    setEditingGeneralNoteId(ann.id);
    setCurrentGeneralNote(ann.note || "");
    setShowGeneralNotePad(true);
    if (!generalNotePadPos) {
      setGeneralNotePadPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }
  }

  async function handleCopyNote(ann: any) {
    try {
      let textToCopy = "";
      if (ann.selectedText || ann.text) {
        textToCopy += `"${ann.selectedText || ann.text}"\n`;
      }
      if ((ann.selectedText || ann.text) && ann.note) {
        textToCopy += `\n`;
      }
      if (ann.note) {
        textToCopy += `Nota: ${ann.note}`;
      }
      await navigator.clipboard.writeText(textToCopy.trim());
      setCopiedAnnotationId(ann.id);
      setTimeout(() => setCopiedAnnotationId(null), 2000);
    } catch (e) {
      console.error("Failed to copy", e);
    }
  }

  async function handleDeleteAnnotation(id: string) {
    const ann = annotations?.find(a => a.id === id);
    if (!ann) return;
    
    const prevData = { ...ann };
    delete (prevData as any).id;

    await deleteDoc(doc(db, 'annotations', id));

    pushToHistory({
      undo: async () => { await setDoc(doc(db, 'annotations', id), prevData); },
      redo: async () => { await deleteDoc(doc(db, 'annotations', id)); }
    });
  }

  async function handleSetReadingMarker(specificIndex?: number) {
    if (!book) return;
    const prevPos = book.readingPosition || 0;
    try {
      const position = specificIndex !== undefined ? specificIndex : selectionRange?.end;
      if (position === undefined) return;

      await updateDoc(doc(db, 'books', book.id), {
        readingPosition: position,
        updatedAt: Date.now()
      });

      pushToHistory({
        undo: async () => { await updateDoc(doc(db, 'books', book.id), { readingPosition: prevPos, updatedAt: Date.now() }); },
        redo: async () => { await updateDoc(doc(db, 'books', book.id), { readingPosition: position, updatedAt: Date.now() }); }
      });

      setSelectionRange(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      console.error("Failed to set reading marker", e);
    }
  }

  async function handleSaveEdit() {
    if (!book) return;
    const normalizedContent = editContent.replace(/\r\n/g, '\n');
    await updateDoc(doc(db, 'books', book.id), {
      title: editTitle.trim(),
      content: normalizedContent,
      updatedAt: Date.now()
    });
    setIsEditing(false);
  }

  function renderContent() {
    if (!book) return null;
    
    const readPos = (book.readingPosition !== undefined && book.readingPosition >= 0) ? book.readingPosition : 0;
    const progressColorClass = book.readingColor || "bg-[#f4f4f4]";

    // Helper to get coordinated colors based on progress selection
    const getProgressTheme = (bg: string) => {
      const c = bg.toLowerCase();
      if (c.includes('#e0f2fe')) return { border: 'border-blue-400', active: 'bg-blue-100', highlight: 'bg-blue-300', text: 'text-blue-900' };
      if (c.includes('#f0fdf4')) return { border: 'border-green-400', active: 'bg-green-100', highlight: 'bg-green-300', text: 'text-green-900' };
      if (c.includes('#fefce8')) return { border: 'border-orange-300', active: 'bg-orange-100', highlight: 'bg-orange-200', text: 'text-orange-900' };
      if (c.includes('#fdf2f8')) return { border: 'border-pink-300', active: 'bg-pink-100', highlight: 'bg-pink-200', text: 'text-pink-900' };
      return { border: 'border-gray-400', active: 'bg-gray-100', highlight: 'bg-gray-300', text: 'text-gray-900' };
    };

    const theme = getProgressTheme(progressColorClass);
    const textAnnotations = annotations?.filter(a => a.startIndex >= 0) || [];

    // Collect all unique split points
    const splitPoints = new Set<number>([0, readPos, book.content.length]);
    textAnnotations.forEach(a => {
      splitPoints.add(a.startIndex);
      splitPoints.add(a.endIndex);
    });

    if (showNotePad && selectionRange) {
      splitPoints.add(selectionRange.start);
      splitPoints.add(selectionRange.end);
    }

    const sortedPoints = Array.from(splitPoints)
      .filter(p => p >= 0 && p <= book.content.length)
      .sort((a, b) => a - b);

    const nodes = [];

    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const start = sortedPoints[i];
      const end = sortedPoints[i + 1];
      if (start === end) continue;

      const segmentText = book.content.substring(start, end);
      const isRead = end <= readPos;
      
      // Find if this segment belongs to any annotation
      // Prioritize the one with the smallest range if there's overlap (simple heuristic)
      const ann = textAnnotations
        .filter(a => start >= a.startIndex && end <= a.endIndex)
        .sort((a, b) => (a.endIndex - a.startIndex) - (b.endIndex - b.startIndex))[0];

      const isTemporaryNewNote = showNotePad && selectionRange && (start >= selectionRange.start && end <= selectionRange.end);

      if (ann || isTemporaryNewNote) {
        const isNote = (ann && ann.note && ann.note.length > 0) || isTemporaryNewNote;
        const colorClass = isTemporaryNewNote ? selectedColor : (ann?.color || "bg-highlight");
        const isActive = activeNoteMenu?.id === ann?.id && activeNoteMenu?.isLocked;
        const useThemedBorder = isRead && isNote;

        nodes.push(
          <mark 
            key={ann ? `${ann.id}-${start}` : `temp-${start}`} 
            className={cn(
              "cursor-pointer transition-all duration-300 relative text-ink", 
              isNote 
                ? cn("bg-transparent border-b-2 pb-0.5", useThemedBorder ? theme.border : "border-gold") 
                : cn("px-1 rounded-sm", isRead ? theme.highlight : colorClass),
              isRead && !isNote && "ring-1 ring-black/5",
              isActive && cn(
                "border-b-2 pb-0.5 shadow-md z-[5] ring-1",
                isRead ? `${theme.active} ${theme.border} ring-black/5` : "bg-gold/10 border-gold ring-gold/20 shadow-[0_4px_12px_-2px_rgba(234,179,8,0.25)]"
              )
            )}
            onPointerEnter={(e) => ann && handleMarkEnter(ann, e)}
            onPointerLeave={handleMarkLeave}
            onPointerDown={(e) => { 
                e.stopPropagation(); 
                if (ann) handleMarkEnter(ann, e, true); 
            }}
          >
            <span className={cn(
              isRead && isNote && `${progressColorClass} opacity-95`,
              isRead && isNote && "font-medium"
            )}>
              {segmentText}
            </span>
          </mark>
        );
      } else {
        nodes.push(
          <span 
            key={`segment-${start}`} 
            className={cn(
              isRead ? `${progressColorClass} text-ink/80` : "text-ink"
            )}
          >
            {segmentText}
          </span>
        );
      }
    }

    return nodes;
  }

  async function handleUpdateReadingColor(color: string) {
    if (!book) return;
    const prevColor = book.readingColor || "bg-[#f4f4f4]";
    try {
      await updateDoc(doc(db, 'books', book.id), {
        readingColor: color,
        updatedAt: Date.now()
      });

      pushToHistory({
        undo: async () => { await updateDoc(doc(db, 'books', book.id), { readingColor: prevColor, updatedAt: Date.now() }); },
        redo: async () => { await updateDoc(doc(db, 'books', book.id), { readingColor: color, updatedAt: Date.now() }); }
      });
    } catch (e) {
      console.error("Failed to update reading color", e);
    }
  }

  function handleExportAI() {
    if (!book) return;
    let markdown = `# ${book.title}\n\n`;

    const generalNotes = annotations?.filter(a => a.startIndex === -1) || [];
    const textAnnotations = annotations?.filter(a => a.startIndex >= 0) || [];

    if (book.readingPosition && book.readingPosition > 0) {
      markdown += `## Progresso de Leitura\n`;
      markdown += `*O usuário já leu aproximadamente ${((book.readingPosition / book.content.length) * 100).toFixed(1)}% do documento.*\n`;
      markdown += `> **Último trecho lido:** ${book.content.substring(Math.max(0, book.readingPosition - 200), book.readingPosition)}\n\n`;
      markdown += `---\n\n`;
    }

    if (generalNotes.length > 0) {
      markdown += `## Resumo / Ideias Gerais\n\n`;
      for (let note of generalNotes) {
        markdown += `* ${note.note}\n`;
      }
      markdown += `\n---\n\n`;
    }
    
    if (!textAnnotations || textAnnotations.length === 0) {
      markdown += book.content;
    } else {
      markdown += `## Texto Integral com Anotações\n\n`;
      const splitPoints = new Set<number>([0, book.content.length]);
      textAnnotations.forEach(a => {
        splitPoints.add(a.startIndex);
        splitPoints.add(a.endIndex);
      });
      const sortedPoints = Array.from(splitPoints).sort((a, b) => a - b);

      for (let i = 0; i < sortedPoints.length - 1; i++) {
        const start = sortedPoints[i];
        const end = sortedPoints[i + 1];
        if (start === end) continue;

        const segmentText = book.content.substring(start, end);
        const overlappingAnns = textAnnotations
          .filter(a => start >= a.startIndex && end <= a.endIndex)
          .sort((a, b) => (a.endIndex - a.startIndex) - (b.endIndex - b.startIndex));

        if (overlappingAnns.length > 0) {
          // If we have overlapping annotations, we'll list the smallest one first or combine comments
          const primaryAnn = overlappingAnns[0];
          markdown += `\n\n> **[TEXTO DESTACADO]:** ${segmentText}\n`;
          overlappingAnns.forEach(ann => {
            if (ann.note) {
              markdown += `> **[COMPETÊNCIA/NOTA]:** ${ann.note}\n`;
            }
          });
          markdown += `\n`;
        } else {
          markdown += segmentText;
        }
      }
    }

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.title}_AI_export.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Pre-render content or early states
  if (bookError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center font-sans text-sm text-ink bg-paper h-full">
        <p className="mb-4">Este documento não existe ou não está público.</p>
        <button onClick={() => setView({type: "library"})} className="px-4 py-2 border border-ink rounded-full hover:bg-ink hover:text-white transition-colors uppercase tracking-widest text-[10px] font-bold">Voltar</button>
      </div>
    );
  }

  if (loadingBook) {
    return (
      <div className="flex-1 flex items-center justify-center font-sans tracking-widest uppercase text-xs text-ink-light bg-paper h-full">
         <div className="flex flex-col items-center gap-4">
            <div className="w-6 h-6 border-2 border-ink/20 border-t-ink rounded-full animate-spin"></div>
            <span>Carregando...</span>
         </div>
      </div>
    );
  }
  
  if (!book) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center font-sans text-sm text-ink bg-paper h-full">
        <p className="mb-4">Documento não encontrado.</p>
        <button onClick={() => setView({type: "library"})} className="px-4 py-2 border border-ink rounded-full hover:bg-ink hover:text-white transition-colors uppercase tracking-widest text-[10px] font-bold">Voltar</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative font-sans">
      
      {/* Immersive Header */}
      <header className="h-16 border-b border-border-light flex items-center justify-between px-4 md:px-10 shrink-0 bg-white/80 backdrop-blur-md z-20 w-full sticky top-0">
        <div className="flex items-center space-x-3 min-w-0">
          <button 
            onClick={() => setView({ type: "library", folderId: book.folderId })}
            className="p-2 -ml-2 text-ink-light hover:text-ink hover:bg-ink/5 rounded-full transition-all active:scale-95 flex items-center"
            title="Fechar Documento"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex flex-col min-w-0">
             <h2 className="text-sm font-bold text-ink truncate md:max-w-md">{book.title}</h2>
             <p className="text-[10px] text-ink-muted font-medium hidden sm:block">NotesBook Reader</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {isPlaying && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-600 rounded-full border border-red-100 animate-in fade-in slide-in-from-right-4">
              <Volume2 className="w-3.5 h-3.5 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider hidden xs:inline">Narração Ativa</span>
            </div>
          )}
          
          <div className="h-8 w-px bg-border-light mx-2 hidden md:block"></div>
        </div>
      </header>

      {/* Main Content & Sidebar Container */}
      <section className="flex-1 flex overflow-hidden bg-white relative">
        
        {/* Floating Menu Button */}
        <AnimatePresence>
          {!showSidebar && (
            <motion.button 
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              onClick={() => setShowSidebar(true)} 
              className="fixed top-20 right-6 md:top-24 md:right-10 w-10 h-10 bg-white shadow-md rounded-full z-30 border border-border-light text-ink hover:bg-ink hover:text-white transition-all focus:outline-none flex items-center justify-center isolate"
              title="Abrir Menu"
            >
              <Menu className="w-4 h-4" />
            </motion.button>
          )}
        </AnimatePresence>
        
        {/* Mobile Sidebar Overlay */}
        <AnimatePresence>
          {showSidebar && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-ink/40 z-40 md:hidden backdrop-blur-sm" 
              onClick={() => setShowSidebar(false)}
            />
          )}
        </AnimatePresence>

        <div className={cn(
          "flex-1 overflow-auto w-full px-6 md:px-16 pt-8 md:pt-16 pb-32 flex flex-col items-center transition-all duration-300 relative",
          showSidebar && "md:blur-sm lg:blur-none md:pointer-events-none lg:pointer-events-auto"
        )}>
          {isEditing ? (
            <div className="max-w-3xl border border-gold/40 bg-surface rounded-lg p-6 shadow-sm mx-auto w-full mb-12 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <span className="text-xs text-ink-muted uppercase tracking-widest font-bold">Modo de Edição</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => setIsEditing(false)} className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-ink hover:underline">Cancelar</button>
                  <button onClick={handleSaveEdit} className="flex items-center gap-2 text-[10px] md:text-xs font-bold uppercase tracking-widest bg-ink text-white px-4 py-2 rounded-full hover:bg-black transition-colors"><Save className="w-3.5 h-3.5"/> Salvar Alterações</button>
                </div>
              </div>
              <div className="bg-orange-50 border border-orange-200 p-4 rounded text-xs text-orange-900 leading-relaxed mb-2">
                <strong>Atenção:</strong> Ao editar o texto de um documento que já possui marcações ou anotações, elas podem perder o seu alinhamento original devido à mudança de caracteres.
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink-light font-bold mb-2">Título do Documento</label>
                <input 
                  value={editTitle} 
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full text-xl md:text-2xl font-serif p-3 bg-white border border-border-dark rounded focus:outline-none focus:border-ink transition-colors"
                />
              </div>
              <div className="flex-1 flex flex-col mt-2">
                <label className="block text-[10px] uppercase tracking-widest text-ink-light font-bold mb-2">Conteúdo de Texto Integral</label>
                <textarea 
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-[50dvh] font-serif text-base md:text-lg leading-relaxed p-4 bg-white border border-border-dark rounded focus:outline-none focus:border-ink transition-colors resize-y"
                />
              </div>
            </div>
          ) : (
            <article 
              className="font-serif text-base md:text-lg text-[#333] relative pb-32 selection:bg-highlight mx-auto transition-all duration-300"
              style={{ width: `${zoomWidth}%`, minWidth: 'min-content' }}
            >
              {book.title && <h3 className="text-3xl md:text-4xl leading-tight mb-8 text-ink">{book.title}</h3>}
              <div ref={contentRef} className="relative leading-relaxed md:leading-relaxed whitespace-pre-wrap">
                {renderContent()}
              </div>
            </article>
          )}
        </div>

        {/* Global Reader Sidebar (Moved to Right and Collapsible) */}
        <aside className={cn(
          "fixed md:sticky top-0 right-0 h-full bg-sidebar shrink-0 z-50 transition-all duration-300 ease-in-out border-l border-border-light overflow-hidden",
          showSidebar ? "w-80 translate-x-0 opacity-100" : "w-0 translate-x-full opacity-0 pointer-events-none border-none"
        )}>
          <div className="flex flex-col h-full w-80 overflow-hidden">
              
              <div className="p-6 border-b border-border-dark bg-sidebar-muted/20">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-ink text-white rounded-lg flex items-center justify-center font-serif italic text-2xl">R</div>
                    <div>
                      <h3 className="text-sm font-bold text-ink">Painel do Leitor</h3>
                      <p className="text-[10px] text-ink-muted">Controles e Anotações</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canEdit && (
                      <>
                        <button 
                          onClick={handleUndo} 
                          disabled={!canUndo}
                          className={cn(
                            "p-2 rounded-full transition-all",
                            canUndo ? "text-ink hover:bg-ink/5 active:scale-90" : "text-ink-light opacity-30 cursor-not-allowed"
                          )}
                          title="Desfazer"
                        >
                          <Undo className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={handleRedo} 
                          disabled={!canRedo}
                          className={cn(
                            "p-2 rounded-full transition-all",
                            canRedo ? "text-ink hover:bg-ink/5 active:scale-90" : "text-ink-light opacity-30 cursor-not-allowed"
                          )}
                          title="Refazer"
                        >
                          <Redo className="w-4 h-4" />
                        </button>
                        <div className="w-px h-4 bg-border-dark mx-1"></div>
                      </>
                    )}
                    <button onClick={() => setShowSidebar(false)} className="p-2 text-ink hover:bg-ink/5 rounded-full transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div className="bg-paper p-3 rounded-lg border border-border-dark flex items-center justify-between">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] text-ink-muted uppercase font-bold tracking-widest">Leitura</span>
                    <span className="text-xs font-bold text-ink">{Math.round(((book.readingPosition || 0) / book.content.length) * 100)}% concluído</span>
                  </div>
                  <div className="w-10 h-10 rounded-full border-2 border-gold flex items-center justify-center">
                      <span className="text-[10px] font-bold text-ink">{Math.round(((book.readingPosition || 0) / book.content.length) * 100)}%</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth custom-scrollbar">
                <nav className="space-y-4">
                  
                  {/* Navigation Section */}
                  <div className="space-y-1">
                    <button 
                      onClick={() => toggleSection('navigation')}
                      className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-widest text-ink-light font-bold hover:text-ink transition-colors"
                    >
                      <span>Navegação</span>
                      {expandedSections.navigation ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    <AnimatePresence initial={false}>
                      {expandedSections.navigation && (
                        <motion.ul 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden space-y-0.5"
                        >
                          <li>
                            <button
                              onClick={() => setView({ type: "library", folderId: book.folderId })}
                              className="w-full flex items-center space-x-3 px-3 py-2 text-sm text-ink-muted hover:bg-ink/5 hover:text-ink rounded-md transition-all"
                            >
                              <Home className="w-4 h-4 shrink-0" />
                              <span>Voltar à Biblioteca</span>
                            </button>
                          </li>
                          <li>
                            <button
                              onClick={() => {
                                handleExportAI();
                                setShowSidebar(false);
                              }}
                              className="w-full flex items-center space-x-3 px-3 py-2 text-sm text-ink-muted hover:bg-ink/5 hover:text-ink rounded-md transition-all"
                            >
                              <Download className="w-4 h-4 shrink-0" />
                              <span>Exportar para IA</span>
                            </button>
                          </li>
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Tools Section */}
                  <div className="space-y-1">
                    <button 
                      onClick={() => toggleSection('tools')}
                      className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-widest text-ink-light font-bold hover:text-ink transition-colors"
                    >
                      <span>Ferramentas de Leitura</span>
                      {expandedSections.tools ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    <AnimatePresence initial={false}>
                      {expandedSections.tools && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden p-3 bg-sidebar-muted/20 border border-border-dark rounded-xl space-y-5"
                        >
                          {/* Audio Controls */}
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 mb-2">
                               <Volume2 className="w-3.5 h-3.5 text-ink-light" />
                               <span className="text-[10px] uppercase tracking-widest text-ink font-bold">Narração em Voz Alta</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <select 
                                value={voiceName} 
                                onChange={(e) => setVoiceName(e.target.value)}
                                className="w-full bg-white border border-border-dark rounded px-2 py-1.5 text-[10px] text-ink outline-none"
                              >
                                {["Kore", "Puck", "Charon", "Fenrir", "Zephyr"].map(v => (
                                  <option key={v} value={v}>{v}</option>
                                ))}
                              </select>
                              <select 
                                value={ttsLanguage} 
                                onChange={(e) => setTtsLanguage(e.target.value)}
                                className="w-full bg-white border border-border-dark rounded px-2 py-1.5 text-[10px] text-ink outline-none"
                              >
                                {["Auto", "Português", "Inglês", "Espanhol"].map(l => (
                                  <option key={l} value={l}>{l}</option>
                                ))}
                              </select>
                            </div>
                            <button 
                              onClick={() => generateAndPlayTTS()}
                              disabled={isGeneratingAudio}
                              className={cn(
                                "w-full py-2 rounded-lg flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all shadow-sm",
                                isPlaying ? "bg-red-500 text-white" : "bg-ink text-white",
                                isGeneratingAudio && "opacity-70 cursor-wait"
                              )}
                            >
                              {isGeneratingAudio ? <Settings className="w-3 h-3 animate-spin" /> : isPlaying ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                              <span>{isGeneratingAudio ? "Gerando..." : isPlaying ? "Parar" : "Ouvir agora"}</span>
                            </button>
                          </div>

                          <hr className="border-border-dark" />

                          {/* Visual Config */}
                          <div className="space-y-3">
                             <div className="flex items-center gap-2 mb-2">
                               <Type className="w-3.5 h-3.5 text-ink-light" />
                               <span className="text-[10px] uppercase tracking-widest text-ink font-bold">Aparência</span>
                            </div>
                            <div>
                               <label className="text-[9px] uppercase font-bold text-ink-muted mb-1 block">Zoom de Leitura: {zoomWidth}%</label>
                               <input 
                                type="range" min="50" max="300" step="5"
                                value={zoomWidth}
                                onChange={(e) => setZoomWidth(Number(e.target.value))}
                                className="w-full h-1.5 bg-paper rounded-lg appearance-none cursor-pointer accent-ink"
                              />
                            </div>
                            <div className="grid grid-cols-5 gap-1.5">
                              {[
                                { name: "Gray", class: "bg-[#f4f4f4]" },
                                { name: "Blue", class: "bg-[#e0f2fe]" },
                                { name: "Green", class: "bg-[#f0fdf4]" },
                                { name: "Sepia", class: "bg-[#fefce8]" },
                                { name: "Pink", class: "bg-[#fdf2f8]" }
                              ].map(color => (
                                <button
                                  key={color.class}
                                  onClick={() => handleUpdateReadingColor(color.class)}
                                  className={cn(
                                    "aspect-square rounded-full border transition-all hover:scale-110",
                                    color.class,
                                    (book.readingColor === color.class || (!book.readingColor && color.class === "bg-[#f4f4f4]")) 
                                      ? "border-ink ring-1 ring-ink/30 ring-offset-1" : "border-transparent"
                                  )}
                                />
                              ))}
                            </div>
                          </div>

                          {canEdit && (
                            <>
                              <hr className="border-border-dark" />
                              <div className="space-y-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <Globe className="w-3.5 h-3.5 text-ink-light" />
                                  <span className="text-[10px] uppercase tracking-widest text-ink font-bold">Colaboração</span>
                                </div>
                                <button 
                                  onClick={async () => {
                                    const newIsPublic = !book.isPublic;
                                    await updateDoc(doc(db, 'books', book.id), { isPublic: newIsPublic, updatedAt: Date.now() });
                                    
                                    const q = query(collection(db, 'annotations'), where('bookId', '==', book.id));
                                    const annsSnap = await getDocs(q);
                                    const batchPromises = annsSnap.docs.map(d => updateDoc(doc(db, 'annotations', d.id), { isBookPublic: newIsPublic }));
                                    await Promise.all(batchPromises);
                                  }}
                                  className="w-full flex items-center justify-between p-2 rounded-lg bg-white border border-border-dark text-[10px] font-bold"
                                >
                                  <span>Link Público</span>
                                  <div className={cn("w-8 h-4 rounded-full relative transition-colors border", book.isPublic ? "bg-green-500 border-green-600" : "bg-paper border-border-light")}>
                                    <div className={cn("absolute top-[1px] left-[1px] w-[12px] h-[12px] bg-white rounded-full transition-transform", book.isPublic ? "translate-x-4" : "")} />
                                  </div>
                                </button>
                                {book.isPublic && (
                                  <button
                                    onClick={async () => {
                                      await navigator.clipboard.writeText(`${window.location.origin}/?book=${book.id}`);
                                      setLinkCopied(true);
                                      setTimeout(() => setLinkCopied(false), 2000);
                                    }}
                                    className="w-full flex items-center justify-between p-2 rounded-lg bg-green-50 text-green-700 border border-green-200 text-[10px] font-bold"
                                  >
                                    <span className="truncate pr-2">Copiar URL</span>
                                    {linkCopied ? <CheckCircle2 className="w-3 h-3" /> : <ClipboardCopy className="w-3 h-3" />}
                                  </button>
                                )}
                              </div>
                            </>
                          )}

                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Annotations Section */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-widest text-ink-light font-bold">
                      <button 
                        onClick={() => toggleSection('annotations')}
                        className="flex-1 flex items-center justify-between hover:text-ink transition-colors"
                      >
                        <span>Anotações e Ideias</span>
                        {expandedSections.annotations ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </button>
                      {canEdit && (
                        <button onClick={() => setShowGeneralNotePad(true)} className="ml-2 p-1 bg-ink/5 rounded hover:bg-ink/10">
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <AnimatePresence initial={false}>
                      {expandedSections.annotations && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden space-y-4"
                        >
                           {/* Ideas */}
                           <div className="space-y-2">
                             {annotations?.filter(a => a.startIndex === -1).map(ann => (
                               <div key={ann.id} className="bg-white border border-border-dark p-3 pb-8 rounded-lg group relative shadow-sm hover:shadow-md transition-all">
                                 <div className="absolute bottom-1 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white pl-2">
                                   <button onClick={() => handleCopyNote(ann)} className="p-1.5 hover:bg-ink/5 rounded" title="Copiar">
                                     {copiedAnnotationId === ann.id ? <CheckCircle2 className="w-3.5 h-3.5 text-ink-light" /> : <ClipboardCopy className="w-3.5 h-3.5 text-ink-light" />}
                                   </button>
                                   {canEdit && (
                                     <>
                                       <button onClick={() => handleOpenEditGeneralNote(ann)} className="p-1.5 hover:bg-ink/5 rounded" title="Editar"><Edit2 className="w-3.5 h-3.5 text-ink-light" /></button>
                                       <button onClick={() => handleDeleteAnnotation(ann.id)} className="p-1.5 hover:bg-red-50 rounded" title="Excluir"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
                                     </>
                                   )}
                                 </div>
                                 <p className="text-[11px] font-sans text-ink leading-relaxed line-clamp-4">{ann.note}</p>
                               </div>
                             ))}
                             {annotations?.filter(a => a.startIndex === -1).length === 0 && (
                               <p className="px-2 py-4 text-center text-[10px] text-ink-muted italic border border-dashed border-border-dark rounded-lg">Sem ideias gerais</p>
                             )}
                           </div>

                           {/* Text Annotations */}
                           <div className="space-y-3 pt-4">
                              <span className="px-2 text-[9px] uppercase font-bold text-ink-muted tracking-wide">Marcadores de Texto</span>
                              {annotations?.filter(a => a.startIndex >= 0).sort((a,b) => a.startIndex - b.startIndex).map((ann, idx) => (
                                <div key={ann.id} className="p-3 border-l-2 border-gold bg-sidebar-muted/10">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[9px] font-bold text-ink/40">#{idx + 1}</span>
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => handleCopyNote(ann)} className="p-1 hover:text-ink transition-colors text-ink/40" title="Copiar">
                                        {copiedAnnotationId === ann.id ? <CheckCircle2 className="w-3 h-3" /> : <ClipboardCopy className="w-3 h-3" />}
                                      </button>
                                      {canEdit && (
                                        <button onClick={() => handleDeleteAnnotation(ann.id)} className="p-1 hover:text-red-500 transition-colors text-ink/40" title="Excluir"><Trash2 className="w-3 h-3" /></button>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-[10px] italic font-serif text-ink-muted leading-relaxed line-clamp-2 mb-2">"{ann.selectedText}"</p>
                                  {ann.note && <p className="text-[11px] font-sans text-ink">{ann.note}</p>}
                                  <button 
                                    onClick={() => contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                                    className="mt-2 text-[9px] font-bold text-ink hover:underline"
                                  >
                                    Ver no texto
                                  </button>
                                </div>
                              ))}
                           </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                </nav>
              </div>

              <div className="p-6 border-t border-border-dark bg-sidebar-muted/30 w-full">
                  <button 
                    onClick={() => {
                      setEditTitle(book?.title || "");
                      setEditContent(book?.content || "");
                      setIsEditing(true);
                      setShowSidebar(false);
                    }}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-white border border-border-dark rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-ink hover:text-white transition-all"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span>Editar Documento</span>
                  </button>
              </div>
            </div>
        </aside>
      </section>

      {/* General Note Popup */}
      {showGeneralNotePad && generalNotePadPos && (
        <div 
          ref={generalNotePadRef}
          className="fixed z-[100] w-full max-w-sm animate-in slide-in-from-right-4 duration-300 pointer-events-auto shadow-2xl"
          style={{
            top: generalNotePadPos.y + 'px',
            left: generalNotePadPos.x + 'px',
            transform: 'translateX(-50%)'
          }}
        >
          <div className="bg-white border border-gold shadow-[0_20px_50px_rgba(0,0,0,0.15)] rounded-lg overflow-hidden flex flex-col">
            <div 
              className="p-4 pb-2 flex items-center justify-between border-b border-sidebar cursor-move select-none"
              onPointerDown={(e) => {
                if (generalNotePadRef.current) {
                  activeDragRef.current = {
                    element: generalNotePadRef.current,
                    startX: e.clientX,
                    startY: e.clientY,
                    initialX: generalNotePadPos.x,
                    initialY: generalNotePadPos.y,
                    type: 'general'
                  };
                }
              }}
            >
              <p className="text-[10px] uppercase tracking-widest text-ink-light font-bold">
                {editingGeneralNoteId ? (canEdit ? "Editar Ideia" : "Detalhes da Ideia") : "Ideia Avulsa"}
              </p>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => { 
                    setShowGeneralNotePad(false); 
                    setCurrentGeneralNote(""); 
                    setEditingGeneralNoteId(null);
                  }}
                  className="p-1 hover:bg-sidebar rounded transition-colors"
                >
                  <X className="w-4 h-4 text-ink-light" />
                </button>
              </div>
            </div>
            <div className="p-4">
              <textarea
                autoFocus
                placeholder="Insira sua observação aqui..."
                className="w-full h-24 resize-none outline-none font-sans text-sm leading-relaxed text-ink placeholder:text-ink-light bg-transparent"
                value={currentGeneralNote}
                onChange={e => setCurrentGeneralNote(e.target.value)}
                readOnly={!canEdit}
              />
            </div>
            <div className="px-4 py-3 bg-sidebar flex items-center justify-between border-t border-border-light">
              <button
                onClick={() => handleCopyNote({ id: editingGeneralNoteId || 'draft-general', note: currentGeneralNote })}
                className="p-1 hover:bg-ink/5 rounded-full transition-colors text-ink/40 hover:text-ink flex items-center justify-center"
                title="Copiar ideia"
              >
                {copiedAnnotationId === (editingGeneralNoteId || 'draft-general') ? <CheckCircle2 className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
              </button>
              {canEdit && (
                <button 
                  onClick={handleAddGeneralNote}
                  className="text-[10px] uppercase tracking-widest bg-ink text-white px-5 py-2 rounded-full font-bold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-30"
                  disabled={!currentGeneralNote.trim()}
                >
                  Salvar Ideia
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {selectionRange && !showNotePad && !showGeneralNotePad && (
        <div 
          className="fixed bg-[#1a1a1a]/95 backdrop-blur-md text-white rounded-full shadow-2xl flex items-center p-1 z-[60] pointer-events-auto border border-white/10 animate-in fade-in zoom-in-95 duration-150"
          style={{
            top: Math.max(80, Math.min(window.innerHeight - 80, selectionRange.rect.top - 55)) + 'px',
            // Safe margin for pill menu (estimated width 350-450px)
            left: Math.max(210, Math.min(window.innerWidth - 210, selectionRange.rect.left + (selectionRange.rect.width / 2))) + 'px',
            transform: 'translateX(-50%)'
          }}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          {canEdit && (
            <>
              <button
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleAddAnnotation(false); }}
                className="flex items-center gap-1.5 px-4 py-2 hover:bg-white/10 rounded-full text-[10px] font-sans font-bold uppercase tracking-widest transition-colors active:scale-95 whitespace-nowrap cursor-pointer touch-none"
                title="Destacar"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-highlight flex-shrink-0" />
                <span>Destacar</span>
              </button>
              <div className="w-px h-4 bg-white/20 mx-0.5"></div>
              <button
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowNotePad(true); }}
                className="flex items-center gap-1.5 px-4 py-2 hover:bg-white/10 rounded-full text-[10px] font-sans font-bold uppercase tracking-widest transition-colors active:scale-95 whitespace-nowrap cursor-pointer touch-none"
                title="Adicionar Nota"
              >
                <Plus className="w-3 h-3" />
                <span>Nota</span>
              </button>
              <div className="w-px h-4 bg-white/20 mx-0.5"></div>
              <button
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleSetReadingMarker(); }}
                className="flex items-center gap-1.5 px-4 py-2 hover:bg-white/10 rounded-full text-[10px] font-sans font-bold uppercase tracking-widest transition-colors active:scale-95 whitespace-nowrap cursor-pointer touch-none text-red-400 hover:text-red-300"
                title="Marcar como Lido"
              >
                <Bookmark className="w-3 h-3 fill-current" />
                <span>Lido</span>
              </button>
              <div className="w-px h-4 bg-white/20 mx-0.5"></div>
            </>
          )}
          <button
            onPointerDown={(e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                generateAndPlayTTS(selectionRange.text); 
            }}
            className="flex items-center gap-1.5 px-4 py-2 hover:bg-white/10 rounded-full text-[10px] font-sans font-bold uppercase tracking-widest transition-colors active:scale-95 whitespace-nowrap cursor-pointer touch-none text-gold hover:text-white"
            title="Ouvir Agora"
          >
            {isGeneratingAudio && !isPlaying ? (
               <Settings className="w-3 h-3 animate-spin" />
            ) : (
               <Play className="w-3 h-3 fill-current" />
            )}
            <span>Ouvir</span>
          </button>
        </div>
      )}

      {showNotePad && selectionRange && notePadPos && (
        <div 
          ref={notePadRef}
          className="fixed z-[100] w-full max-w-sm animate-in fade-in zoom-in-95 duration-200 pointer-events-auto shadow-2xl"
          style={{
            top: notePadPos.y + 'px',
            left: notePadPos.x + 'px',
            transform: 'translateX(-50%)'
          }}
        >
          <div className="bg-white border border-border-dark rounded-lg overflow-hidden flex flex-col shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)]">
            <div 
              className="p-4 pb-2 flex items-center justify-between border-b border-sidebar bg-surface cursor-move select-none"
              onPointerDown={(e) => {
                if (notePadRef.current) {
                  activeDragRef.current = {
                    element: notePadRef.current,
                    startX: e.clientX,
                    startY: e.clientY,
                    initialX: notePadPos.x,
                    initialY: notePadPos.y,
                    type: 'note'
                  };
                }
              }}
            >
              <p className="text-[10px] uppercase tracking-widest text-ink-light font-bold">
                {editingAnnotationId ? (canEdit ? "Editar Anotação" : "Detalhes da Anotação") : "Anotar Seleção"}
              </p>
              <button 
                onClick={() => { 
                  setShowNotePad(false); 
                  setSelectionRange(null);
                  setEditingAnnotationId(null);
                }}
                className="p-1 hover:bg-sidebar rounded transition-colors"
              >
                <X className="w-4 h-4 text-ink-light" />
              </button>
            </div>
            <div className="p-4">
              <p className="text-[10px] font-serif italic text-ink-light mb-3 line-clamp-2 border-l-2 border-gold pl-2">
                "{selectionRange.text}"
              </p>
              <textarea
                autoFocus
                placeholder="O que você está pensando sobre este trecho?"
                className="w-full h-24 resize-none outline-none font-serif text-sm leading-relaxed text-ink placeholder:text-ink-light bg-transparent"
                value={currentNote}
                onChange={e => setCurrentNote(e.target.value)}
                readOnly={!canEdit}
              />
            </div>
            <div className="px-4 py-3 bg-sidebar flex items-center justify-between border-t border-border-light">
              <div className="flex items-center gap-1.5">
                {["bg-highlight", "bg-gold/30", "bg-[#e0ddd5]"].map(color => (
                  <button
                    key={color}
                    onClick={() => canEdit && setSelectedColor(color)}
                    className={cn("w-4 h-4 rounded-full border transition-all", canEdit ? "cursor-pointer" : "cursor-default", color, selectedColor === color ? "border-ink scale-110" : "border-transparent")}
                  />
                ))}
                <div className="w-px h-4 bg-border-dark mx-2"></div>
                <button
                  onClick={() => handleCopyNote({ id: editingAnnotationId || 'draft', selectedText: selectionRange?.text, note: currentNote })}
                  className="p-1 hover:bg-ink/5 rounded-full transition-colors text-ink/40 hover:text-ink flex items-center justify-center"
                  title="Copiar"
                >
                  {copiedAnnotationId === (editingAnnotationId || 'draft') ? <CheckCircle2 className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
                </button>
              </div>
              {canEdit && (
                <button 
                  onClick={() => handleAddAnnotation(true)}
                  className="text-[10px] uppercase tracking-widest bg-ink text-white px-5 py-2 rounded-full font-bold hover:opacity-90 transition-opacity"
                >
                  Salvar Nota
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The large empty audio panel has been removed since we put it in the header */}

      {/* Active Note Hover Menu */}
      {activeNoteMenu && !showNotePad && !selectionRange && (
        <div 
          className="fixed bg-[#1a1a1a] text-white rounded-lg shadow-2xl flex items-center p-1.5 z-[60] pointer-events-auto border border-white/10 animate-in fade-in zoom-in-95 duration-100"
          style={{
            top: Math.max(80, Math.min(window.innerHeight - 80, activeNoteMenu.rect.top - 60)) + 'px',
            // Safe margin for hover menu (estimated width 350-450px)
            left: Math.max(210, Math.min(window.innerWidth - 210, activeNoteMenu.rect.left + (activeNoteMenu.rect.width / 2))) + 'px',
            transform: 'translateX(-50%)'
          }}
          onPointerEnter={() => { if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current); }}
          onPointerLeave={handleMarkLeave}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          {activeNoteMenu.note && (
            <>
              <button
                onPointerDown={(e) => { 
                    e.preventDefault(); 
                    e.stopPropagation(); 
                    handleOpenEditNote(activeNoteMenu);
                }}
                className="flex items-center gap-1.5 px-3 py-2 hover:bg-white/10 rounded-md text-[11px] font-sans font-semibold uppercase tracking-wider transition-colors active:scale-95 whitespace-nowrap cursor-pointer touch-none"
                title="Ver Nota"
              >
                <Plus className="w-3 h-3 rotate-45" />
                <span>Ver Nota</span>
              </button>
              <div className="w-px h-5 bg-white/20 mx-1"></div>
            </>
          )}
          <button
            onPointerDown={(e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                generateAndPlayTTS(activeNoteMenu.text); 
            }}
            className="flex items-center gap-1.5 px-3 py-2 hover:bg-white/10 rounded-md text-[11px] font-sans font-semibold uppercase tracking-wider transition-colors active:scale-95 whitespace-nowrap cursor-pointer touch-none text-gold hover:text-white"
          >
            {isGeneratingAudio && !isPlaying ? (
               <Settings className="w-3.5 h-3.5 animate-spin" />
            ) : (
               <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>Ouvir Agora</span>
          </button>
          {canEdit && (
            <>
              <div className="w-px h-5 bg-white/20 mx-1"></div>
              <button
                onPointerDown={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  handleDeleteAnnotation(activeNoteMenu.id);
                  setActiveNoteMenu(null);
                }}
                className="flex items-center gap-1.5 px-3 py-2 hover:bg-white/10 rounded-md text-[11px] font-sans font-semibold uppercase tracking-wider transition-colors active:scale-95 whitespace-nowrap cursor-pointer touch-none text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Excluir</span>
              </button>
            </>
          )}
        </div>
      )}

    </div>
  );
}
