import { collection, query, where, doc, setDoc, deleteDoc, getDocs, updateDoc } from "firebase/firestore";
import { useCollection } from "react-firebase-hooks/firestore";
import { Plus, Trash2, LogOut, Menu, X, Search, Folder as FolderIcon, FileText, ArrowRightLeft, Globe, ChevronDown, ChevronRight, Home } from "lucide-react";
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { v4 as uuidv4 } from "uuid";
import { db, logout } from "../firebase";
import { ViewState } from "../App";
import { cn } from "../lib/utils";

interface LibraryProps {
  currentFolderId?: string;
  setView: (view: ViewState) => void;
  userId: string;
}

export function Library({ currentFolderId, setView, userId }: LibraryProps) {
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isAddingBook, setIsAddingBook] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState("");
  const [newBookContent, setNewBookContent] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    collections: true,
    folders: true,
    actions: true
  });
  
  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };
  
  const [searchTerm, setSearchTerm] = useState("");
  const [bookToDelete, setBookToDelete] = useState<string | null>(null);
  const [bookToMove, setBookToMove] = useState<string | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<{ id: string, name: string } | null>(null);

  const foldersRef = collection(db, 'folders');
  const [foldersSnapshot] = useCollection(query(foldersRef, where('userId', '==', userId)));
  const folders = foldersSnapshot?.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).sort((a,b) => a.createdAt - b.createdAt);

  const booksRef = collection(db, 'books');
  const bookQuery = currentFolderId 
    ? query(booksRef, where('userId', '==', userId), where('folderId', '==', currentFolderId))
    : query(booksRef, where('userId', '==', userId));
  
  const [booksSnapshot] = useCollection(bookQuery);
  const books = booksSnapshot?.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).sort((a,b) => b.createdAt - a.createdAt);

  // Search logic looking at titles and actual textual content
  const displayedBooks = books?.filter(book => {
    const term = searchTerm.toLowerCase();
    if (!term) return true;
    return book.title.toLowerCase().includes(term) || (book.content && book.content.toLowerCase().includes(term));
  });

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const id = uuidv4();
    await setDoc(doc(db, 'folders', id), {
      userId,
      name: newFolderName.trim(),
      createdAt: Date.now(),
    });
    setNewFolderName("");
    setIsAddingFolder(false);
  }

  async function handleCreateBook(e: React.FormEvent) {
    e.preventDefault();
    if (!newBookTitle.trim() || !newBookContent.trim()) return;
    const id = uuidv4();
    
    // Normalize newlines on save matching the Reader pattern unconditionally
    const normalizedContent = newBookContent.replace(/\r\n/g, '\n');
    
    await setDoc(doc(db, 'books', id), {
      userId,
      title: newBookTitle.trim(),
      content: normalizedContent,
      folderId: currentFolderId || "",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setNewBookTitle("");
    setNewBookContent("");
    setIsAddingBook(false);
    setView({ type: "reader", bookId: id });
  }

  function handleDeleteBookRequest(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setBookToDelete(id);
  }

  async function confirmDelete() {
    if (!bookToDelete) return;
    const id = bookToDelete;
    setBookToDelete(null);
    
    try {
      // Clean up annotations first
      const annsQuery = query(collection(db, 'annotations'), where('userId', '==', userId), where('bookId', '==', id));
      const annsSnapshot = await getDocs(annsQuery);
      const deletePromises = annsSnapshot.docs.map(annDoc => deleteDoc(annDoc.ref));
      await Promise.all(deletePromises);

      // Delete document
      await deleteDoc(doc(db, 'books', id));
    } catch (error) {
      console.error("Failed to delete book", error);
    }
  }

  async function handleMoveBook(folderId: string) {
    if (!bookToMove) return;
    try {
      await updateDoc(doc(db, 'books', bookToMove), {
        folderId: folderId,
        updatedAt: Date.now()
      });
    } catch (error) {
      console.error("Failed to move book", error);
    }
    setBookToMove(null);
  }

  async function confirmDeleteFolder() {
    if (!folderToDelete) return;
    const { id } = folderToDelete;
    setFolderToDelete(null);
    try {
      // First, remove the folderId from all books in this folder so we don't lose them
      const booksInFolderQuery = query(collection(db, 'books'), where('userId', '==', userId), where('folderId', '==', id));
      const booksInFolderSnapshot = await getDocs(booksInFolderQuery);
      const updatePromises = booksInFolderSnapshot.docs.map(docSnap => 
        updateDoc(doc(db, 'books', docSnap.id), { folderId: "" })
      );
      await Promise.all(updatePromises);

      // Now delete the folder itself
      await deleteDoc(doc(db, 'folders', id));
      if (currentFolderId === id) {
        setView({ type: "library", folderId: undefined });
      }
    } catch (error) {
      console.error("Failed to delete folder", error);
    }
  }

  const navigateTo = (view: ViewState) => {
    setView(view);
    setIsSidebarOpen(false); 
    setSearchTerm(""); 
  }

  return (
    <div className="flex flex-1 overflow-hidden h-full relative">
      
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-ink/40 z-40 md:hidden backdrop-blur-sm" 
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar Navigation */}
      <aside className={cn(
        "fixed md:relative w-72 border-r border-border-dark flex flex-col h-full bg-sidebar shrink-0 z-50 transition-all duration-300",
        isSidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-ink text-white rounded-lg flex items-center justify-center font-serif italic text-xl">N</div>
              <h1 className="text-xl font-serif italic tracking-tight font-bold text-ink">NotesBook</h1>
            </div>
            <button className="md:hidden p-2 hover:bg-ink/5 rounded-full transition-colors" onClick={() => setIsSidebarOpen(false)}>
              <X className="w-5 h-5 text-ink-light" />
            </button>
          </div>

          <div className="px-6 pb-6 space-y-4">
            {/* New Document Button */}
            <button 
              onClick={() => { setIsAddingBook(true); setIsSidebarOpen(false); }}
              className="w-full py-2.5 px-4 bg-ink text-white rounded-lg text-sm font-medium flex items-center justify-center space-x-2 transition-all active:scale-95 hover:bg-black shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Novo Documento</span>
            </button>

            {/* Integrated Search Bar */}
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-light group-focus-within:text-ink transition-colors" />
              <input
                type="text"
                placeholder="Pesquisar..."
                className="w-full bg-paper border border-border-dark rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-ink transition-colors text-ink placeholder:text-ink-light"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto px-4 custom-scrollbar">
            <nav className="space-y-1">
              
              {/* Collections Section */}
              <div className="mb-2">
                <button 
                  onClick={() => toggleSection('collections')}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-widest text-ink-light font-bold hover:text-ink transition-colors"
                >
                  <span>Coleções</span>
                  {expandedSections.collections ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                <AnimatePresence initial={false}>
                  {expandedSections.collections && (
                    <motion.ul 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <li>
                        <button
                          onClick={() => navigateTo({ type: "library" })}
                          className={cn(
                            "flex items-center space-x-3 w-full px-2 py-2 text-sm rounded-md transition-all",
                            !currentFolderId ? "bg-ink/5 text-ink font-semibold" : "text-ink-muted hover:bg-ink/5 hover:text-ink"
                          )}
                        >
                          <Home className={cn("w-4 h-4 shrink-0", !currentFolderId ? "text-gold" : "text-ink-light")} />
                          <span>Todos os Documentos</span>
                        </button>
                      </li>
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

              {/* Folders Section */}
              <div className="mb-2">
                <div className="flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-widest text-ink-light font-bold">
                  <button 
                    onClick={() => toggleSection('folders')}
                    className="flex flex-1 items-center justify-between group hover:text-ink transition-colors"
                  >
                    <span>Pastas</span>
                    {expandedSections.folders ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </button>
                  <button 
                    onClick={() => setIsAddingFolder(true)}
                    className="ml-2 hover:text-ink transition-colors p-1 bg-ink/5 rounded"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <AnimatePresence initial={false}>
                  {expandedSections.folders && (
                    <motion.ul 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden space-y-0.5"
                    >
                      {isAddingFolder && (
                        <li className="px-2 py-1">
                          <form onSubmit={handleCreateFolder}>
                            <input
                              autoFocus
                              type="text"
                              placeholder="Nome da pasta..."
                              className="w-full text-xs px-2 py-1.5 border border-border-dark rounded outline-none bg-paper text-ink placeholder:text-ink-light focus:border-ink transition-colors"
                              value={newFolderName}
                              onChange={(e) => setNewFolderName(e.target.value)}
                              onBlur={() => { if (!newFolderName) setIsAddingFolder(false); }}
                            />
                          </form>
                        </li>
                      )}
                      {folders?.map(folder => (
                        <li key={folder.id}>
                          <button
                            onClick={() => navigateTo({ type: "library", folderId: folder.id })}
                            className={cn(
                              "w-full flex items-center space-x-3 px-2 py-2 text-sm rounded-md transition-all truncate",
                              currentFolderId === folder.id ? "bg-ink/5 text-ink font-semibold" : "text-ink-muted hover:bg-ink/5 hover:text-ink"
                            )}
                          >
                            <FolderIcon className={cn("w-4 h-4 shrink-0", currentFolderId === folder.id ? "text-gold" : "text-ink-light")} />
                            <span className="truncate">{folder.name}</span>
                          </button>
                        </li>
                      ))}
                      {(!folders || folders.length === 0) && !isAddingFolder && (
                        <li className="px-2 py-4 text-center">
                          <p className="text-[10px] text-ink-muted italic">Nenhuma pasta criada</p>
                        </li>
                      )}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

              {/* Actions/Settings Section */}
              <div className="mt-8">
                <button 
                  onClick={() => toggleSection('actions')}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-widest text-ink-light font-bold hover:text-ink transition-colors"
                >
                  <span>Sistema</span>
                  {expandedSections.actions ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                <AnimatePresence initial={false}>
                  {expandedSections.actions && (
                    <motion.ul 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <li>
                        <button
                          onClick={logout}
                          className="w-full flex items-center space-x-3 px-2 py-2 text-sm text-ink-muted hover:bg-red-50 hover:text-red-500 rounded-md transition-all"
                        >
                          <LogOut className="w-4 h-4" />
                          <span>Finalizar Sessão</span>
                        </button>
                      </li>
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

            </nav>
          </div>
          
          <div className="p-6 border-t border-border-dark bg-sidebar-muted/30">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-full bg-paper border border-border-dark flex items-center justify-center shrink-0">
                <span className="text-xs font-serif italic text-ink-muted">U</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-ink truncate">Usuário NotesBook</p>
                <p className="text-[10px] text-ink-muted truncate">Premium Plan</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full bg-white relative w-full overflow-hidden">
        
        {/* Header - Much simpler now */}
        <header className="border-b border-border-light flex items-center justify-between px-6 md:px-10 h-16 bg-white shrink-0">
          <div className="flex items-center space-x-4 min-w-0">
            <button
              className="md:hidden p-2 -ml-2 text-ink-light hover:text-ink hover:bg-ink/5 rounded-full transition-all"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex flex-col min-w-0">
              <h2 className="text-sm font-bold text-ink truncate">
                {currentFolderId
                  ? folders?.find(f => f.id === currentFolderId)?.name || 'Pasta'
                  : 'Meus Documentos'}
              </h2>
              <p className="text-[10px] text-ink-muted font-medium hidden sm:block">
                {searchTerm ? 'Resultados da pesquisa' : `${displayedBooks?.length || 0} documentos`}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
             {/* Search icon for mobile to quickly open sidebar? Or just let them use sidebar */}
             <button 
              onClick={() => setIsAddingBook(true)}
              className="hidden sm:flex text-[10px] uppercase font-bold tracking-widest border border-ink px-4 py-2 rounded-full hover:bg-ink hover:text-white transition-all shadow-sm active:scale-95"
            >
              Novo Documento
            </button>
            <div className="w-8 h-8 rounded-full bg-paper border border-border-dark flex items-center justify-center sm:hidden">
              <span className="text-[10px] font-serif italic text-ink-muted">U</span>
            </div>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto px-6 md:px-10 py-8 md:py-12">
          <div className="max-w-5xl mx-auto w-full">
            
            {/* Adding Document Form */}
            {isAddingBook && (
              <div className="mb-10 p-6 md:p-8 bg-paper border border-border-dark rounded-md shadow-sm">
                <h3 className="font-serif italic text-xl mb-6 text-ink border-b border-border-light pb-4">Importar Novo Documento</h3>
                <form onSubmit={handleCreateBook} className="space-y-6">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-ink-light font-bold mb-2">Título</label>
                    <input
                      required
                      type="text"
                      value={newBookTitle}
                      onChange={(e) => setNewBookTitle(e.target.value)}
                      className="w-full bg-white border border-border-dark rounded-sm px-4 py-2 focus:outline-none focus:border-ink transition-colors font-serif text-ink placeholder:text-ink-light placeholder:font-sans"
                      placeholder="Ex: Dom Casmurro"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-ink-light font-bold mb-2">Conteúdo do Texto Integral</label>
                    <textarea
                      required
                      value={newBookContent}
                      onChange={(e) => setNewBookContent(e.target.value)}
                      rows={8}
                      className="w-full bg-white border border-border-dark rounded-sm px-4 py-3 focus:outline-none focus:border-ink transition-colors font-serif text-ink placeholder:text-ink-light placeholder:font-sans leading-relaxed"
                      placeholder="Cole o seu texto aqui..."
                    />
                  </div>
                  <div className="flex justify-end gap-4 pt-4 border-t border-border-light">
                    <button
                      type="button"
                      onClick={() => setIsAddingBook(false)}
                      className="text-xs font-medium uppercase tracking-widest text-ink-muted hover:text-ink transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="text-xs font-medium uppercase tracking-widest bg-ink text-white px-6 py-2 rounded-full hover:bg-black transition-colors"
                    >
                      Salvar e Ler
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Folders Prominent Highlighted Section */}
            {!currentFolderId && !searchTerm && folders && folders.length > 0 && !isAddingBook && (
              <div className="mb-12">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[10px] uppercase tracking-widest text-ink-light font-bold">Resumo de Pastas</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {folders.map(folder => {
                    const folderBooksCount = booksSnapshot?.docs.filter(d => d.data().folderId === folder.id).length || 0;
                    return (
                      <div key={folder.id} className="relative group">
                        <button
                          onClick={() => navigateTo({ type: "library", folderId: folder.id })}
                          className="w-full flex flex-col p-5 bg-surface border border-border-dark hover:border-ink hover:shadow-md transition-all rounded-xl text-left"
                        >
                          <div className="flex items-center justify-between mb-4 w-full">
                            <div className="w-10 h-10 rounded-full bg-paper flex items-center justify-center border border-border-light group-hover:border-gold transition-colors">
                              <FolderIcon className="w-5 h-5 text-gold" />
                            </div>
                            <span className="text-[10px] font-sans font-bold text-ink-muted uppercase tracking-wider">{folderBooksCount} docs</span>
                          </div>
                          <span className="font-serif italic text-lg text-ink line-clamp-1 pr-6">{folder.name}</span>
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setFolderToDelete({ id: folder.id, name: folder.name }); }}
                          className="absolute right-3 bottom-4 md:opacity-0 group-hover:opacity-100 text-ink-light hover:text-red-500 bg-white shadow-sm border border-border-light hover:border-red-200 transition-all p-1.5 rounded-md flex items-center justify-center hover:bg-red-50 z-10"
                          title="Excluir pasta"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Documents Grid / Search Results */}
            {!isAddingBook && (
              <>
                {(currentFolderId || searchTerm || (folders && folders.length > 0)) && (
                   <div className="mb-6 flex items-center justify-between border-b border-border-light pb-3">
                     <h3 className="text-[10px] uppercase tracking-widest text-ink-light font-bold">
                       {searchTerm ? `Resultados da Pesquisa (${displayedBooks?.length || 0})` : 'Documentos Recentes'}
                     </h3>
                   </div>
                )}

                {displayedBooks?.length === 0 ? (
                  <div className="text-center py-24 text-ink-muted bg-surface/50 rounded-xl border border-dashed border-border-dark">
                    <FileText className="w-8 h-8 mx-auto text-ink-light mb-4 opacity-50" />
                    <p className="font-serif italic text-xl mb-4 text-ink">
                      {searchTerm ? 'Nenhum documento encontrado.' : 'Nenhum documento adicionado ainda.'}
                    </p>
                    {!searchTerm && (
                      <button 
                          onClick={() => setIsAddingBook(true)}
                          className="text-sm border border-border-dark inline-block px-5 py-2.5 bg-paper rounded-full mt-2 hover:bg-border-light transition-colors text-ink font-medium"
                      >
                          Adicionar um documento
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
                    {displayedBooks?.map(book => (
                      <div 
                        key={book.id} 
                        onClick={() => navigateTo({ type: "reader", bookId: book.id })}
                        className="group flex flex-col min-h-[12rem] bg-white border border-border-dark p-6 cursor-pointer hover:border-ink hover:shadow-sm transition-all relative rounded-lg"
                      >
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-[9px] text-ink-light tracking-widest uppercase font-bold m-0">
                              {folders?.find(f => f.id === book.folderId)?.name || 'Sem Pasta'}
                            </p>
                            {book.isPublic && (
                              <Globe className="w-3.5 h-3.5 text-green-600 shrink-0" title="Público" />
                            )}
                          </div>
                          <h3 className="font-serif italic text-lg leading-snug text-ink line-clamp-3">
                            {book.title}
                          </h3>
                          {/* Search Snippet */}
                          {searchTerm && book.content && book.content.toLowerCase().includes(searchTerm.toLowerCase()) && (
                            <div className="mt-4 text-xs text-ink-muted leading-relaxed font-serif line-clamp-3 bg-surface p-3 rounded border border-border-light shadow-inner">
                              {(() => {
                                const lowerContent = book.content.toLowerCase();
                                const lowerTerm = searchTerm.toLowerCase();
                                const index = lowerContent.indexOf(lowerTerm);
                                const start = Math.max(0, index - 40);
                                const end = Math.min(book.content.length, index + searchTerm.length + 40);
                                const snippet = book.content.slice(start, end);
                                const snippetIndex = snippet.toLowerCase().indexOf(lowerTerm);
                                return (
                                  <>
                                    <span className="opacity-50">{start > 0 ? "..." : ""}</span>
                                    <span>{snippet.slice(0, snippetIndex)}</span>
                                    <mark className="bg-highlight text-ink font-bold px-1 rounded-sm">{snippet.slice(snippetIndex, snippetIndex + searchTerm.length)}</mark>
                                    <span>{snippet.slice(snippetIndex + searchTerm.length)}</span>
                                    <span className="opacity-50">{end < book.content.length ? "..." : ""}</span>
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                        <div className="mt-6 flex items-center justify-between pt-4 border-t border-border-light">
                          <span className="text-[10px] text-ink-muted uppercase tracking-wider font-sans font-bold">
                            {new Date(book.createdAt).toLocaleDateString()}
                          </span>
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={(e) => { e.stopPropagation(); setBookToMove(book.id); }}
                              className="md:opacity-0 group-hover:opacity-100 text-ink-light hover:text-ink transition-all p-2 rounded flex items-center justify-center hover:bg-border-light"
                              title="Mover documento"
                            >
                              <ArrowRightLeft className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => handleDeleteBookRequest(book.id, e)}
                              className="md:opacity-0 group-hover:opacity-100 text-ink-light hover:text-red-500 transition-all p-2 -mr-2 rounded flex items-center justify-center hover:bg-red-50"
                              title="Excluir documento"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

          </div>
        </section>
      </main>

      {/* Move Document Modal */}
      {bookToMove && (
        <div className="fixed inset-0 min-h-[100dvh] bg-paper/90 backdrop-blur-sm flex items-center justify-center z-[150] p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white border border-border-dark shadow-2xl w-full max-w-sm rounded-xl overflow-hidden flex flex-col">
            <div className="p-6">
              <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center mb-4 border border-border-dark">
                 <ArrowRightLeft className="w-5 h-5 text-ink" />
              </div>
              <h3 className="font-serif italic text-xl mb-2 text-ink">Mover Documento</h3>
              <p className="text-sm text-ink-muted font-sans mb-6 leading-relaxed">
                Selecione o destino para este documento:
              </p>
              
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-2">
                <button
                  onClick={() => handleMoveBook("")}
                  className="w-full text-left px-4 py-3 rounded-lg border border-border-dark hover:border-ink hover:bg-surface transition-all flex items-center gap-3"
                >
                  <FileText className="w-4 h-4 text-ink-light" />
                  <span className="text-sm font-medium text-ink">Sem pasta</span>
                </button>
                {folders?.map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => handleMoveBook(folder.id)}
                    className="w-full text-left px-4 py-3 rounded-lg border border-border-dark hover:border-ink hover:bg-surface transition-all flex items-center gap-3"
                  >
                    <FolderIcon className="w-4 h-4 text-gold" />
                    <span className="text-sm font-medium text-ink truncate">{folder.name}</span>
                  </button>
                ))}
              </div>

            </div>
            <div className="px-6 py-4 bg-surface border-t border-border-light flex items-center justify-end">
              <button 
                onClick={() => setBookToMove(null)}
                className="text-[10px] uppercase tracking-widest font-bold text-ink-light hover:text-ink px-4 py-2.5 transition-colors rounded-full hover:bg-border-light"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Folder Confirmation Modal */}
      {folderToDelete && (
        <div className="fixed inset-0 min-h-[100dvh] bg-paper/90 backdrop-blur-sm flex items-center justify-center z-[150] p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white border border-border-dark shadow-2xl w-full max-w-sm rounded-xl overflow-hidden flex flex-col">
            <div className="p-6">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-4 border border-red-100">
                 <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-serif italic text-xl mb-2 text-ink">Apagar pasta?</h3>
              <p className="text-sm text-ink-muted font-sans leading-relaxed">
                Tem certeza que deseja excluir a pasta "<strong>{folderToDelete.name}</strong>"?<br/><br/>
                Os documentos dentro dela <strong>não serão apagados</strong>, eles serão movidos para "Todos os Documentos".
              </p>
            </div>
            <div className="px-6 py-4 bg-surface border-t border-border-light flex items-center justify-end gap-3">
              <button 
                onClick={() => setFolderToDelete(null)}
                className="text-[10px] uppercase tracking-widest font-bold text-ink-light hover:text-ink px-4 py-2.5 transition-colors rounded-full hover:bg-border-light"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDeleteFolder}
                className="text-[10px] uppercase tracking-widest font-bold bg-red-600 text-white hover:bg-red-700 px-5 py-2.5 rounded-full transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {bookToDelete && (
        <div className="fixed inset-0 min-h-[100dvh] bg-paper/90 backdrop-blur-sm flex items-center justify-center z-[150] p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white border border-border-dark shadow-2xl w-full max-w-sm rounded-xl overflow-hidden flex flex-col">
            <div className="p-6">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-4 border border-red-100">
                 <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-serif italic text-xl mb-2 text-ink">Apagar documento?</h3>
              <p className="text-sm text-ink-muted font-sans leading-relaxed">
                Tem certeza que deseja apagar permanentemente este documento? Todas as anotações e a leitura serão perdidas e não podem ser desfeitas.
              </p>
            </div>
            <div className="px-6 py-4 bg-surface border-t border-border-light flex items-center justify-end gap-3">
              <button 
                onClick={() => setBookToDelete(null)}
                className="text-[10px] uppercase tracking-widest font-bold text-ink-light hover:text-ink px-4 py-2.5 transition-colors rounded-full hover:bg-border-light"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDelete}
                className="text-[10px] uppercase tracking-widest font-bold bg-red-600 text-white hover:bg-red-700 px-5 py-2.5 rounded-full transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
