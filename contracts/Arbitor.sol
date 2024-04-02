// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Lock.sol";

contract Arbitor {
    address public  arbiter;
    address public seller;

    event TransactionCreated(uint indexed id, address indexed buyer, uint256 amount, uint256 productID, uint256 txId);
    event TransactionSigned(uint indexed id, address indexed signer);
    event TransactionConfirmed(uint indexed id);
    event TransactionRefunded(uint indexed id, address indexed buyer, uint256 amount);
    event DisputeRaised(uint indexed id, address indexed buyer, string reason);
    event DisputeResolved(uint indexed id);

    uint public transactionCount;
    uint public voteRequired = 2;
    uint public delay = block.timestamp + 3600;

    struct Transaction {
        address buyer;
        uint256 amount;
        uint256 productID;
        uint256 txId;
        uint256 voteCount;
        bool isConfirmed;
    }

    struct Dispute {
        string reason;
        bool stillOpen;
    }
   

    mapping(uint => Transaction) public transactions;
    mapping(uint => Dispute) public disputes;
    mapping(uint => mapping(address => bool)) public voted;

    receive()payable external{
     
    }

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "Only the arbiter can call this function");
        _;
    }

    modifier onlyBuyer(uint id) {
        require(msg.sender == transactions[id].buyer, "Only the buyer can call this function");
        _;
    }

    modifier onlySeller() {
        require(tx.origin == seller, "Only the seller can call this function");
        _;
    }

    constructor(address _seller)  {
        arbiter = msg.sender;
        seller = _seller;
    }

    function createTransaction(address _buyer, uint256 _amount, uint256 _productID, uint256 _txId) external onlySeller {
        uint id = transactionCount;
        transactions[id] = Transaction({
            buyer: _buyer,
            amount: _amount,
            productID: _productID,
            txId: _txId,
            voteCount: 0,
            isConfirmed: false
        });
        transactionCount++;
        emit TransactionCreated(id, _buyer, _amount, _productID, _txId);
    }

    function signTransaction(uint id) external {
        require(msg.sender == arbiter || msg.sender == seller, "Only the arbiter or seller can call this function");
        require(!voted[id][msg.sender], "You have already voted for this transaction");
        transactions[id].voteCount++;
        voted[id][msg.sender] = true;
        emit TransactionSigned(id, msg.sender);
    }

    function executeTransaction(uint id, address lockAddress) external onlyArbiter {
        require(block.timestamp >= delay, "Transaction delay period not elapsed yet");
        require(transactions[id].voteCount >= voteRequired, "Not enough votes to confirm the transaction");
        require(!disputes[id].stillOpen, "Dispute for this transaction is unresolved");
        transactions[id].isConfirmed = true;

        Lock lock = Lock(lockAddress);
        lock.releaseFund(transactions[id].txId);

        emit TransactionConfirmed(id);
    }

    function refundTransaction(uint id, address lockAddress) external onlyArbiter {
        require(transactions[id].isConfirmed == false, "Transaction already confirmed");
        require(disputes[id].stillOpen, "Dispute for this transaction is resolved");

        Lock lock = Lock(lockAddress);
        lock.refund(transactions[id].txId);

        transactions[id].isConfirmed = true;
        disputes[id].stillOpen = false;

        emit TransactionRefunded(id, transactions[id].buyer, transactions[id].amount);
    }

    function raiseDispute(uint id, string memory reason) external onlyBuyer(id) {
        require(block.timestamp <= delay,"Transaction delay period has elapsed");
        require(!disputes[id].stillOpen, "Dispute for this transaction is already resolved");
        disputes[id] = Dispute({
            reason: reason,
            stillOpen: true
        });
        emit DisputeRaised(id, msg.sender, reason);
    }

    function resolveDispute(uint id) external onlyArbiter {
        require(disputes[id].stillOpen == true, "Dispute for this transaction is already resolved");
        disputes[id].stillOpen = false;
        emit DisputeResolved(id);
    }
    function hasVoted(uint id, address _address) external view returns (bool) {
        return voted[id][_address];
    }
}
