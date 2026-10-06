/* Tally's internal interface. */
#ifndef TALLY_H
#define TALLY_H
int count_file(const char *path);
int count_lines(const char *path);
char *text_load(const char *path);
int text_words(const char *s);
void text_free(char *s);
#endif
