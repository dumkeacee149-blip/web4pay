// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal USDC escrow with oracle-controlled release/refund and deadline.
/// @dev v1 focus: deposit → release/refund. Dispute/early-withdraw comes later.
contract Escrow {
    enum Status {
        NONE,
        OPEN,
        DEPOSITED,
        RELEASED,
        REFUNDED
    }

    struct Deal {
        address payer;
        address payee;
        uint256 amount;
        uint64 deadline;
        Status status;
        bytes32 metaHash;
    }

    IERC20 public immutable token;
    address public immutable oracle;

    uint256 public nextId = 1;
    mapping(uint256 => Deal) public deals;

    event DealCreated(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount, uint64 deadline, bytes32 metaHash);
    event Deposited(uint256 indexed id, address indexed payer, uint256 amount);
    event Released(uint256 indexed id, address indexed payee, uint256 amount, bytes32 deliverableHash);
    event Refunded(uint256 indexed id, address indexed payer, uint256 amount, bytes32 reasonHash);

    error NotOracle();
    error InvalidStatus();
    error DeadlineInPast();
    error NotPayer();

    constructor(address token_, address oracle_) {
        token = IERC20(token_);
        oracle = oracle_;
    }

    /// @notice Create a new escrow deal.
    /// @param payee Recipient address.
    /// @param amount Token amount.
    /// @param deadline Unix timestamp (seconds) after which refund is allowed.
    /// @param metaHash Hash binding offchain context (quoteHash/orderHash/etc.).
    function createDeal(address payee, uint256 amount, uint64 deadline, bytes32 metaHash) external returns (uint256 id) {
        if (deadline <= uint64(block.timestamp)) revert DeadlineInPast();

        id = nextId++;
        deals[id] = Deal({
            payer: msg.sender,
            payee: payee,
            amount: amount,
            deadline: deadline,
            status: Status.OPEN,
            metaHash: metaHash
        });

        emit DealCreated(id, msg.sender, payee, amount, deadline, metaHash);
    }

    /// @notice Deposit funds into escrow.
    /// @dev payer must approve token transfer to this contract.
    function deposit(uint256 id) external {
        Deal storage d = deals[id];
        if (d.status != Status.OPEN) revert InvalidStatus();
        if (msg.sender != d.payer) revert NotPayer();

        d.status = Status.DEPOSITED;
        require(token.transferFrom(msg.sender, address(this), d.amount), "TRANSFER_FROM_FAILED");

        emit Deposited(id, msg.sender, d.amount);
    }

    /// @notice Oracle releases escrow to payee.
    function release(uint256 id, bytes32 deliverableHash) external {
        if (msg.sender != oracle) revert NotOracle();
        Deal storage d = deals[id];
        if (d.status != Status.DEPOSITED) revert InvalidStatus();

        d.status = Status.RELEASED;
        require(token.transfer(d.payee, d.amount), "TRANSFER_FAILED");

        emit Released(id, d.payee, d.amount, deliverableHash);
    }

    /// @notice Oracle refunds escrow to payer. Typically on timeout/cancel.
    /// @dev If now < deadline, oracle can still refund (policy decision). Clients should enforce rules offchain.
    function refund(uint256 id, bytes32 reasonHash) external {
        if (msg.sender != oracle) revert NotOracle();
        Deal storage d = deals[id];
        if (d.status != Status.DEPOSITED) revert InvalidStatus();

        d.status = Status.REFUNDED;
        require(token.transfer(d.payer, d.amount), "TRANSFER_FAILED");

        emit Refunded(id, d.payer, d.amount, reasonHash);
    }

    /// @notice Permissionless refund after deadline.
    function refundAfterDeadline(uint256 id) external {
        Deal storage d = deals[id];
        if (d.status != Status.DEPOSITED) revert InvalidStatus();
        if (uint64(block.timestamp) < d.deadline) revert InvalidStatus();

        d.status = Status.REFUNDED;
        require(token.transfer(d.payer, d.amount), "TRANSFER_FAILED");
        emit Refunded(id, d.payer, d.amount, keccak256("deadline"));
    }
}
