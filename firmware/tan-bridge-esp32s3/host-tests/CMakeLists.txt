cmake_minimum_required(VERSION 3.20)
project(tan_bridge_host_tests C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

find_package(Python3 REQUIRED COMPONENTS Interpreter)

get_filename_component(REPO_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../.." ABSOLUTE)
set(GENERATED_DIR "${CMAKE_BINARY_DIR}/generated")
file(MAKE_DIRECTORY "${GENERATED_DIR}")
execute_process(
  COMMAND
    "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_LIST_DIR}/generate_fixtures.py"
    "${REPO_ROOT}/packages/device-sassi/test/fixtures.ts"
    "${GENERATED_DIR}/tan_sassi_fixtures.h"
  RESULT_VARIABLE FIXTURE_RESULT
)
if(NOT FIXTURE_RESULT EQUAL 0)
  message(FATAL_ERROR "Canonical SASSI fixture generation failed")
endif()

add_executable(
  tan_bridge_host_tests
  test_main.c
  test_policy.c
  test_sassi.c
  test_session.c
  test_spool.c
  ../components/tan_bridge_api/tan_bridge_api.c
  ../components/tan_identity/tan_identity.c
  ../components/tan_roaster_session/tan_roaster_session.c
  ../components/tan_sassi/tan_sassi.c
  ../components/tan_spool/tan_spool.c
  ../components/tan_update/tan_update.c
  ../components/tan_usb_device/tan_usb_device_policy.c
  ../components/tan_wifi/tan_wifi.c
)
target_include_directories(
  tan_bridge_host_tests
  PRIVATE
    "${GENERATED_DIR}"
    ../components/tan_board/include
    ../components/tan_bridge_api/include
    ../components/tan_identity/include
    ../components/tan_roaster_session/include
    ../components/tan_sassi/include
    ../components/tan_spool/include
    ../components/tan_update/include
    ../components/tan_usb_device/include
    ../components/tan_wifi/include
    stubs
)
target_compile_options(
  tan_bridge_host_tests PRIVATE -Wall -Wextra -Werror -Wpedantic
)

enable_testing()
add_test(NAME native_foundation COMMAND tan_bridge_host_tests)
add_test(
  NAME api_contract
  COMMAND
    "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_LIST_DIR}/test_api_contract.py"
    "${CMAKE_CURRENT_LIST_DIR}/../components/tan_bridge_api/openapi.json"
    "${REPO_ROOT}/apps/service/src/tan_bridge.rs"
)
