-- SnowTS Cortex Search Service Definitions
-- Replace {{DB}} with your database name and {{WH}} with your warehouse name before executing.

-- Full-text search over ALL article content (notes, raw docs, wiki)
CREATE CORTEX SEARCH SERVICE IF NOT EXISTS {{DB}}.APP.SNOWTS_SEARCH_SERVICE
  ON content
  ATTRIBUTES title, source_type, client_name
  WAREHOUSE = '{{WH}}'
  TARGET_LAG = '1 hour'
  AS (
    SELECT id, title, content, source_type, client_name, tags_text
    FROM {{DB}}.APP.ARTICLE_CONTENT
  );

-- Full-text search filtered to wiki articles only
CREATE CORTEX SEARCH SERVICE IF NOT EXISTS {{DB}}.APP.WIKI_SEARCH_SERVICE
  ON content
  ATTRIBUTES title, source_type, client_name, tags_text
  WAREHOUSE = '{{WH}}'
  TARGET_LAG = '1 hour'
  AS (
    SELECT id, title, content, source_type, client_name, tags_text
    FROM {{DB}}.APP.ARTICLE_CONTENT
    WHERE source_type = 'wiki'
  );
