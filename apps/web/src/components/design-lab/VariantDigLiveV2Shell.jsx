import Link from "next/link";
import styles from "./VariantDigLiveV2Shell.module.css";

function RowList({ items }) {
  if (!items || items.length === 0) {
    return <p className={styles.footerNote}>No data.</p>;
  }

  return (
    <ul className={styles.list}>
      {items.map((item, idx) => {
        const key = `${item.index || idx}-${item.title || "row"}`;
        const content = item.href ? (
          <Link className={styles.rowTitle} href={item.href} target={item.external ? "_blank" : undefined}>
            {item.title}
          </Link>
        ) : (
          <span className={styles.rowTitle}>{item.title}</span>
        );

        return (
          <li key={key} className={styles.row}>
            <span className={styles.rowIndex}>{item.index || String(idx + 1).padStart(2, "0")}</span>
            <div>
              {content}
              {item.subtitle ? <div className={styles.rowSub}>{item.subtitle}</div> : null}
            </div>
            <span className={styles.rowMeta}>{item.meta || ""}</span>
          </li>
        );
      })}
    </ul>
  );
}

function CardList({ items }) {
  if (!items || items.length === 0) {
    return <p className={styles.footerNote}>No linked items.</p>;
  }

  return (
    <div className={styles.cards}>
      {items.map((item, idx) => {
        const key = `${item.title || "card"}-${idx}`;
        const cardBody = (
          <>
            <div className={styles.cardTitle}>{item.title}</div>
            {item.subtitle ? <div className={styles.cardSub}>{item.subtitle}</div> : null}
          </>
        );

        if (item.href) {
          return (
            <Link key={key} className={styles.card} href={item.href} target={item.external ? "_blank" : undefined}>
              {cardBody}
            </Link>
          );
        }

        return (
          <div key={key} className={styles.card}>
            {cardBody}
          </div>
        );
      })}
    </div>
  );
}

/**
 * @param {{
 * title: string;
 * subtitle?: string;
 * eyebrow?: string;
 * queryValue?: string;
 * searchTarget?: string;
 * coverImage?: string | null;
 * facts?: Array<{label: string; value: string}>;
 * actions?: Array<{label: string; href: string; primary?: boolean; external?: boolean}>;
 * primaryTitle?: string;
 * primaryItems?: Array<{index?: string; title: string; subtitle?: string; meta?: string; href?: string; external?: boolean}>;
 * secondaryTitle?: string;
 * secondaryItems?: Array<{index?: string; title: string; subtitle?: string; meta?: string; href?: string; external?: boolean}>;
 * sideTopTitle?: string;
 * sideTopItems?: Array<{title: string; subtitle?: string; href?: string; external?: boolean}>;
 * sideBottomTitle?: string;
 * sideBottomItems?: Array<{title: string; subtitle?: string; href?: string; external?: boolean}>;
 * mediaVideos?: Array<{title: string; url: string; embedUrl?: string | null; duration?: string; thumb?: string}>;
 * footerNote?: string;
 * }} props
 */
export default function VariantDigLiveV2Shell(props) {
  const {
    title,
    subtitle,
    eyebrow,
    queryValue = "",
    searchTarget = "/design-lab/live-v2/search",
    coverImage,
    facts = [],
    actions = [],
    primaryTitle = "Primary",
    primaryItems = [],
    secondaryTitle = "Secondary",
    secondaryItems = [],
    sideTopTitle = "Links",
    sideTopItems = [],
    sideBottomTitle = "More",
    sideBottomItems = [],
    mediaVideos = [],
    footerNote,
  } = props;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Link href="/design-lab" className={styles.logo}>
          Dig / Design Lab
        </Link>

        <form action={searchTarget} method="get" className={styles.searchForm}>
          <input className={styles.searchInput} name="q" defaultValue={queryValue} placeholder="Search artists, labels, releases" />
          <button className={styles.searchBtn} type="submit">
            Search
          </button>
        </form>

        <nav className={styles.nav}>
          <Link href="/design-lab/live-v2" className={styles.navLink}>
            Live v2
          </Link>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.cover}>
            {coverImage ? (
              <img className={styles.coverImage} src={coverImage} alt={title} />
            ) : (
              <div className={styles.coverPlaceholder}>dig</div>
            )}
          </div>

          <div className={styles.metaTop}>
            {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
            <h1 className={styles.title}>{title}</h1>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}

            {facts.length > 0 ? (
              <div className={styles.facts}>
                {facts.map((fact) => (
                  <div key={`${fact.label}:${fact.value}`} className={styles.fact}>
                    <span className={styles.factLabel}>{fact.label}</span>
                    <span className={styles.factValue}>{fact.value}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {actions.length > 0 ? (
              <div className={styles.actions}>
                {actions.map((action) => (
                  <Link
                    key={`${action.label}:${action.href}`}
                    href={action.href}
                    target={action.external ? "_blank" : undefined}
                    className={`${styles.action} ${action.primary ? styles.actionPrimary : ""}`}
                  >
                    {action.label}
                  </Link>
                ))}
              </div>
            ) : null}

            {mediaVideos.length > 0 ? (
              <section className={styles.mediaInline}>
                <h2 className={styles.mediaInlineTitle}>YouTube</h2>
                <div className={styles.mediaInlineGrid}>
                  {mediaVideos.slice(0, 2).map((video, i) => (
                    <div key={`${video.url}-${i}`} className={styles.mediaInlineCard}>
                      {video.embedUrl ? (
                        <iframe
                          className={styles.mediaFrame}
                          src={video.embedUrl}
                          title={video.title}
                          loading="lazy"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allowFullScreen
                        />
                      ) : video.thumb ? (
                        <a href={video.url} target="_blank" rel="noreferrer" className={styles.mediaThumbLink}>
                          <img className={styles.mediaThumb} src={video.thumb} alt={video.title} />
                        </a>
                      ) : null}
                      <a href={video.url} target="_blank" rel="noreferrer" className={styles.mediaCaption}>
                        {video.title}
                      </a>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </section>

        <section className={styles.grid}>
          <div>
            <h2 className={styles.sectionTitle}>{primaryTitle}</h2>
            <RowList items={primaryItems} />

            <h2 className={styles.sectionTitle} style={{ marginTop: "1.6rem" }}>
              {secondaryTitle}
            </h2>
            <RowList items={secondaryItems} />
          </div>

          <aside>
            <h2 className={styles.sectionTitle}>{sideTopTitle}</h2>
            <CardList items={sideTopItems} />

            <h2 className={styles.sectionTitle} style={{ marginTop: "1.6rem" }}>
              {sideBottomTitle}
            </h2>
            <CardList items={sideBottomItems} />
          </aside>
        </section>

        {footerNote ? <p className={styles.footerNote}>{footerNote}</p> : null}
      </main>
    </div>
  );
}
