// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "./Arbitor.sol";
import "hardhat/console.sol";
contract Lock {
    address public seller; 
    address public delivery;
    address public  executor;
    uint public transactionCount;
    enum Status {
        CREATED,
        DELIVERED,
        CONFIRMED,
        COMPLETED,
        PENDING,
        REFUNDED,
        CANCELLED,
        FAILED
    }
    struct Transaction {
        address buyer;
        uint256 amount;
        uint256 productID;
        Status status;
    }
    mapping(address => mapping(uint => Transaction[])) public userProductTransactions;
    mapping(uint => Transaction) public userTransactions;
    event Deposited(address indexed buyer, uint256 amount, uint256 productID, uint256 transactionIndex);
    event DeliveryConfirmed(address indexed buyer, uint256 transactionIndex);
    event FundRequested(address indexed executor, uint256 transactionId);
    event FundReleased(address indexed seller, address indexed buyer, uint256 amount);
    event FundRefunded(address indexed seller, address indexed buyer, uint256 amount);

    modifier isNotSeller() {
        require(msg.sender != seller, "You are the seller");
        _;
    }

    modifier isDelivery() {
        require(msg.sender == delivery, "You are not the delivery agency");
        _;
    }

    constructor(address  _delivery) {
        seller =  msg.sender;
        delivery = _delivery;
    }

    function deposit(uint256 _productID) external payable isNotSeller {
        require(msg.value > 0, "You need to send some ether");
        uint id = transactionCount;
        Transaction storage transaction = userTransactions[id];
        transaction.buyer = msg.sender;
        transaction.amount = msg.value;
        transaction.productID = _productID;
        transaction.status = Status.CREATED;
        userProductTransactions[msg.sender][_productID].push(transaction);
        transactionCount++;
        emit Deposited(msg.sender, msg.value, _productID, id);
    }

    function confirmDelivery(uint256 _transactionId) external isDelivery {
        Transaction storage transaction = userTransactions[_transactionId];
        require(transaction.status == Status.CREATED, "Delivery already confirmed");
        transaction.status = Status.DELIVERED;
        userProductTransactions[transaction.buyer][transaction.productID].push(transaction);
        emit DeliveryConfirmed(msg.sender, _transactionId);
    }

    function deliveryConfirm(uint256 _transactionId) external {
        Transaction storage transaction = userTransactions[_transactionId];
        require(transaction.buyer == msg.sender, "Only the buyer can confirm the delivery");
        require(transaction.status == Status.DELIVERED, "Delivery not yet confirmed by delivery agency");
        transaction.status = Status.CONFIRMED;
        userProductTransactions[transaction.buyer][transaction.productID].push(transaction);
    }

    function requestForFund(uint256 _transactionId, address payable _executor) external {
        require(seller == msg.sender, "Only the seller can request for fund");
        Transaction storage transaction = userTransactions[_transactionId];
        require(transaction.status == Status.CONFIRMED, "Transaction not confirmed yet");
        executor = _executor;
        Arbitor arbitor = Arbitor(_executor);
        arbitor.createTransaction(transaction.buyer, transaction.amount, transaction.productID, _transactionId);
        transaction.status = Status.PENDING;
        emit FundRequested(_executor, _transactionId);
    }

    function releaseFund(uint256 _transactionId) external {
        Transaction storage transaction = userTransactions[_transactionId];
        require(executor == msg.sender, "Only the executor can release funds");
        require(transaction.status == Status.PENDING, "Transaction not confirmed yet");
        // Take 5% of the money and send to the executor
        uint fivepercent =  transaction.amount * 5 / 100;
        payable(executor).transfer( fivepercent);
        // Transfer funds to the seller
        payable(seller).transfer(transaction.amount - fivepercent);
        transaction.status = Status.COMPLETED;
        userProductTransactions[transaction.buyer][transaction.productID].push(transaction);
        emit FundReleased(seller, transaction.buyer, transaction.amount);
    }

    function refund(uint256 _transactionId) external {
        Transaction storage transaction = userTransactions[_transactionId];
        require(executor == msg.sender, "Only the executor can refund");
        require(transaction.status == Status.PENDING, "Transaction not confirmed yet");
        // Take 5% of the money and send to the executor
        uint treepercent =transaction.amount * 3 / 100;
        payable(executor).transfer( treepercent);
        // Transfer funds to the buyer
        payable(transaction.buyer).transfer(transaction.amount - treepercent);
        transaction.status = Status.REFUNDED;
        emit FundRefunded(seller, transaction.buyer, transaction.amount);
    }
   

}