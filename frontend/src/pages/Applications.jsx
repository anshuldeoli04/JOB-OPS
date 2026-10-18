import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Panel from '../components/ui/Panel';
import DataTable from '../components/ui/DataTable';
import EmptyState from '../components/ui/EmptyState';
import { useAppStore } from '../store/useAppStore';

const PAGE_SIZE = 25;
const gradeRank = { A: 5, B: 4, C: 3, D: 2, F: 1 };

export default function Applications() {
  const applications = useAppStore((state) => state.applications);
  const updateStatus = useAppStore((state) => state.updateStatus);
  const bulkUpdateStatus = useAppStore((state) => state.bulkUpdateStatus);
  const [expandedId, setExpandedId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    return applications
      .filter((item) => {
        const gradeMatch = gradeFilter === 'ALL' || item.grade === gradeFilter;
        const statusMatch = statusFilter === 'ALL' || item.status === statusFilter;
        const searchMatch =
          !search ||
          `${item.company} ${item.role}`.toLowerCase().includes(search.toLowerCase());
        return gradeMatch && statusMatch && searchMatch;
      })
      .sort((a, b) => {
        const gradeDiff = (gradeRank[b.grade] || 0) - (gradeRank[a.grade] || 0);
        if (gradeDiff) return gradeDiff;
        const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
        if (scoreDiff) return scoreDiff;
        return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
      });
  }, [applications, gradeFilter, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  const resetPage = (setter) => (value) => {
    setter(value);
    setPage(1);
    setExpandedId(null);
    setSelectedIds([]);
  };

  return (
    <Panel
      title="Applications tracker"
      subtitle="Filters, row expand, inline status updates, and bulk actions are now scaffolded."
      action={
        <div className="toolbar-inline">
          <button className="secondary-button" type="button" onClick={() => bulkUpdateStatus(selectedIds, 'applied')} disabled={!selectedIds.length}>
            Mark Applied
          </button>
        </div>
      }
    >
      <div className="filter-row">
        <input className="text-input" placeholder="Search company or role" value={search} onChange={(e) => resetPage(setSearch)(e.target.value)} />
        <select className="status-select" value={gradeFilter} onChange={(e) => resetPage(setGradeFilter)(e.target.value)}>
          {['ALL', 'A', 'B', 'C', 'D', 'F'].map((grade) => <option key={grade}>{grade}</option>)}
        </select>
        <select className="status-select" value={statusFilter} onChange={(e) => resetPage(setStatusFilter)(e.target.value)}>
          {['ALL', 'evaluated', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'].map((status) => <option key={status}>{status}</option>)}
        </select>
      </div>

      {rows.length ? (
        <div className="paginated-table-shell">
          <DataTable
            rows={pageRows}
            expandedId={expandedId}
            onExpand={setExpandedId}
            selectedIds={selectedIds}
            onSelect={(id, checked) =>
              setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((item) => item !== id)))
            }
            onSelectAll={(checked) =>
              setSelectedIds((prev) => {
                const pageIds = pageRows.map((item) => item.id);
                if (checked) return [...new Set([...prev, ...pageIds])];
                return prev.filter((id) => !pageIds.includes(id));
              })
            }
            onStatusChange={updateStatus}
          />
          <div className="pagination-bar">
            <span>
              Showing {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, rows.length)} of {rows.length} jobs
            </span>
            <div className="pagination-controls">
              <button
                className="icon-button"
                type="button"
                onClick={() => {
                  setPage((value) => Math.max(1, value - 1));
                  setExpandedId(null);
                }}
                disabled={currentPage === 1}
                title="Previous page"
                aria-label="Previous page"
              >
                <ChevronLeft size={18} />
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button
                className="icon-button"
                type="button"
                onClick={() => {
                  setPage((value) => Math.min(totalPages, value + 1));
                  setExpandedId(null);
                }}
                disabled={currentPage === totalPages}
                title="Next page"
                aria-label="Next page"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState title="No matching applications" body="Adjusting your filters or search keywords will display matching applications here." />
      )}
    </Panel>
  );
}
