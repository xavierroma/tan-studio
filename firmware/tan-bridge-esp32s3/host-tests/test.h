#ifndef TAN_HOST_TEST_H
#define TAN_HOST_TEST_H

#include <stdio.h>
#include <stdlib.h>

#define TAN_ASSERT(condition)                                                  \
    do {                                                                       \
        if (!(condition)) {                                                    \
            fprintf(stderr, "assertion failed at %s:%d: %s\n", __FILE__,      \
                    __LINE__, #condition);                                     \
            abort();                                                           \
        }                                                                      \
    } while (0)

void test_policy(void);
void test_sassi(void);
void test_session(void);
void test_spool(void);

#endif
