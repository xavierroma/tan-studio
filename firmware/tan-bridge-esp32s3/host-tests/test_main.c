#include "test.h"

int main(void)
{
    test_policy();
    test_sassi();
    test_session();
    test_spool();
    puts("tan bridge host tests passed");
    return 0;
}
