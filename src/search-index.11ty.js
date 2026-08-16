class SearchIndex {
  data() {
    return {
      permalink: "search-index.json",
      eleventyExcludeFromCollections: true
    };
  }

  render({ catalog }) {
    const items = catalog.documents.map((document) => ({
      id: document.id,
      title: document.title,
      description: document.description,
      route: document.route,
      moduleKey: document.moduleKey,
      unitTitle: document.unitTitle,
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
