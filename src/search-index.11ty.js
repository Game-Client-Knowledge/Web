class SearchIndex {
  data() {
    return {
      permalink: "search-index.json",
      eleventyExcludeFromCollections: true
    };
  }

  render({ catalog }) {
    const documents = catalog.contribution
      ? [...catalog.documents, catalog.contribution]
      : catalog.documents;
    const items = documents.map((document) => ({
      id: document.id,
      title: document.title,
      description: document.description,
      route: document.route,
      moduleKey: document.moduleKey,
      moduleSlug: document.moduleSlug,
      trackKey: document.trackKey,
      unitTitle: document.unitTitle || "内容更新规范",
      kind: document.kind,
      text: document.searchText
    }));

    return JSON.stringify({
      commit: catalog.repository.commit,
      items
    });
  }
}

module.exports = SearchIndex;
