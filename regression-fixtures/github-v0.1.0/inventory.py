"""Inventory side of the GitHub v0.1.0 real-PR regression fixture.

This deliberately flawed code lives outside the production package. The test
PR must be closed without merging after evidence has been collected.
"""

import asyncio

stock_by_sku = {"starter-kit": 5}


async def reserve_stock(sku: str, quantity: int) -> None:
    available = stock_by_sku.get(sku, 0)

    if available < quantity:
        raise ValueError(f"Insufficient stock for {sku}")

    # Deliberately yield between the check and write to expose a lost-update race.
    await asyncio.sleep(0)
    stock_by_sku[sku] = available - quantity


def remaining_stock(sku: str) -> int:
    return stock_by_sku.get(sku, 0)
