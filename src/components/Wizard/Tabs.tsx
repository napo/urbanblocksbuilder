import { useState, type ReactNode } from 'react'

export interface TabDefinition {
  id: string
  label: string
  content: ReactNode
}

export interface TabsProps {
  tabs: TabDefinition[]
  initialTabId?: string
  ariaLabel: string
}

/**
 * Horizontal tabs: preferred over vertical tabs here because the sidebar is
 * narrow (~400px) and holds a small, fixed number of sections (3-4) - the
 * classic case where horizontal tabs read faster than a vertical rail, per
 * standard UI-pattern guidance (vertical tabs pay off mainly with many
 * items or when the labels themselves need more horizontal room).
 */
export function Tabs({ tabs, initialTabId, ariaLabel }: TabsProps) {
  const [activeId, setActiveId] = useState(initialTabId ?? tabs[0]?.id)
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <div role="tablist" aria-label={ariaLabel} className="tab-list">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === activeTab?.id}
            aria-controls={`tabpanel-${tab.id}`}
            className={tab.id === activeTab?.id ? 'tab active' : 'tab'}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`tabpanel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== activeTab?.id}
          style={{ display: tab.id === activeTab?.id ? 'grid' : 'none', gap: '1rem' }}
        >
          {tab.content}
        </div>
      ))}
    </div>
  )
}
