import sqlparse


def split_sql_statements(query):
    def strip_trailing_comments(stmt):
        idx = len(stmt.tokens) - 1
        while idx >= 0:
            tok = stmt.tokens[idx]
            if tok.is_whitespace or sqlparse.utils.imt(tok, i=sqlparse.sql.Comment, t=sqlparse.tokens.Comment):
                stmt.tokens[idx] = sqlparse.sql.Token(sqlparse.tokens.Whitespace, " ")
            else:
                break
            idx -= 1
        return stmt

    def strip_trailing_semicolon(stmt):
        idx = len(stmt.tokens) - 1
        while idx >= 0:
            tok = stmt.tokens[idx]
            # we expect that trailing comments already are removed
            if not tok.is_whitespace:
                if sqlparse.utils.imt(tok, t=sqlparse.tokens.Punctuation) and tok.value == ";":
                    stmt.tokens[idx] = sqlparse.sql.Token(sqlparse.tokens.Whitespace, " ")
                break
            idx -= 1
        return stmt

    def is_empty_statement(stmt):
        # copy statement object. `copy.deepcopy` fails to do this, so just re-parse it
        st = sqlparse.engine.FilterStack()
        st.stmtprocess.append(sqlparse.filters.StripCommentsFilter())
        stmt = next(st.run(str(stmt)), None)
        if stmt is None:
            return True

        return str(stmt).strip() == ""

    stack = sqlparse.engine.FilterStack()

    result = [stmt for stmt in stack.run(query)]
    result = [strip_trailing_comments(stmt) for stmt in result]
    result = [strip_trailing_semicolon(stmt) for stmt in result]
    result = [str(stmt).strip() for stmt in result if not is_empty_statement(stmt)]

    if len(result) > 0:
        return result

    return [""]  # if all statements were empty - return a single empty statement


def combine_sql_statements(queries):
    return ";\n".join(queries)


def find_last_keyword_idx(parsed_query):
    for i in reversed(range(len(parsed_query.tokens))):
        if parsed_query.tokens[i].ttype in sqlparse.tokens.Keyword:
            return i
    return -1
