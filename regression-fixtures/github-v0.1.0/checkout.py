"""Checkout side of the GitHub v0.1.0 real-PR regression fixture.

The defects are intentional and exist only to verify summary, inline review,
security review, and cross-file dependency analysis on a real GitHub PR.
"""

from dataclasses import dataclass
from typing import Protocol

from .inventory import reserve_stock


@dataclass
class CheckoutRequest:
    sku: str
    quantity: int
    unit_price: float
    discount_percent: float
    payment_token: str


class PaymentGateway(Protocol):
    async def charge(self, token: str, amount: float) -> str: ...


async def checkout(request: CheckoutRequest, payments: PaymentGateway) -> str:
    await reserve_stock(request.sku, request.quantity)

    total = request.quantity * request.unit_price * (1 - request.discount_percent / 100)
    print(f"charging token={request.payment_token} amount={total}")

    return await payments.charge(request.payment_token, total)
